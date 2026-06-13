import React, { useState, useEffect } from 'react';
import { supabase } from './supabaseClient'; 

export default function AdminDashboard() {
  const API_BASE = 'https://nal-api-backend.onrender.com';
  
  // 1. 系统核心基础状态矩阵
  const [galleryTime, setGalleryTime] = useState({ start: '', end: '', deadline: '' });
  const [pendingCount, setPendingCount] = useState(0);
  const [isReviewing, setIsReviewing] = useState(false);
  const [isCurating, setIsCurating] = useState(false);
  const [works, setWorks] = useState([]);
  const [logMessages, setLogMessages] = useState([]);

  // 多赛季全生命周期管理状态
  const [contests, setContests] = useState([]); 
  const [selectedContestId, setSelectedContestId] = useState(''); 
  const [activeContestId, setActiveContestId] = useState(''); 
  const [isContestActive, setIsContestActive] = useState(false); 

  const [newContestName, setNewContestName] = useState('');
  const [newContestDesc, setNewContestDesc] = useState('');
  const [showCreateForm, setShowCreateForm] = useState(false);

  // 2. 模拟终端日志打印器
  const addLog = (msg) => {
    const time = new Date().toLocaleTimeString();
    setLogMessages(prev => [`[${time}] ${msg}`, ...prev]);
  };

  // 3. 初始化实时监听与核心加载大阵
  useEffect(() => {
    fetchContestMetadata();
    
    const subscription = supabase
      .channel('contest-dashboard-radar')
      .on(
        'postgres_changes', 
        { event: 'UPDATE', schema: 'public', table: 'contest_submissions' }, 
        (payload) => {
          const targetId = payload.new.id.substring(0, 8);
          if (payload.old.status === 'pending' && payload.new.status === 'processing') {
             addLog(`⏳ [AI 引擎] 已锁定作品 ${targetId}，正在解析...`);
             fetchDashboardData(selectedContestId); 
          }
          if (payload.new.status === 'success' && payload.old.status !== 'success') {
             addLog(`✅ [实时战报] 作品 ${targetId} 评审完毕！入库成功。`);
             setTimeout(() => fetchDashboardData(selectedContestId), 500); 
          }
          if (payload.new.status === 'invalid') {
             addLog(`❌ [拦截] 作品 ${targetId} 未达参赛门槛，已自动拦截。`);
             fetchDashboardData(selectedContestId);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(subscription);
    };
  }, [selectedContestId]);

  const fetchContestMetadata = async () => {
    try {
      const { data: contestList, error: cErr } = await supabase
        .from('contests')
        .select('*')
        .order('created_at', { ascending: false });

      if (cErr) console.error("🚨 抓取赛事表发生错误:", cErr.message);

      const { data: settings, error: sErr } = await supabase
        .from('site_settings')
        .select('current_contest_id, is_contest_active')
        .eq('id', 1)
        .maybeSingle();

      if (settings) {
        setActiveContestId(settings.current_contest_id || '');
        setIsContestActive(settings.is_contest_active);
      }

      if (contestList && contestList.length > 0) {
        setContests(contestList);
        if (!selectedContestId) {
          const defaultId = settings?.current_contest_id || contestList[0].id;
          setSelectedContestId(defaultId);
          fetchDashboardData(defaultId);
          syncTimeState(defaultId, contestList);
        } else {
          syncTimeState(selectedContestId, contestList);
        }
      } else {
        const fallbackList = [{ id: '2026_contest', name: '2026 第一届“童心”文学大赏' }];
        setContests(fallbackList);
        setSelectedContestId('2026_contest');
        fetchDashboardData('2026_contest');
      }
    } catch (err) {
      console.error('拉取赛季元数据失败:', err);
    }
  };

  const syncTimeState = (contestId, list) => {
    const target = list.find(c => c.id === contestId);
    if (target) {
      setGalleryTime({
        // 🌟 核心修正：substring 截取前 10 位 (YYYY-MM-DD)，剔除时分干扰
        deadline: target.submission_deadline ? target.submission_deadline.substring(0, 10) : '',
        start: target.gallery_start_time ? target.gallery_start_time.substring(0, 10) : '',
        end: target.gallery_end_time ? target.gallery_end_time.substring(0, 10) : ''
      });
    }
  };

  const fetchDashboardData = async (contestId) => {
    if (!contestId) return;
    try {
      const { count: pendingCount, error: pendingError } = await supabase
        .from('contest_submissions')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'pending')
        .eq('contest_id', contestId); 
      
      if (pendingError) console.error("🚨 抓取待审被拦截:", pendingError.message);
      setPendingCount(pendingCount || 0);

      const { data: submissions, error: successError } = await supabase
        .from('contest_submissions')
        .select('id, word_count, ai_total_score, ai_variance, is_manual_recommended, manual_rank')
        .eq('status', 'success')
        .eq('contest_id', contestId) 
        .order('ai_total_score', { ascending: false });

      if (successError) console.error("🚨 抓取展厅数据被拦截:", successError.message);
      setWorks(submissions || []);
    } catch (err) {
      console.error('管理台数据加载错误:', err);
    }
  };

  const handleCreateNewContest = async (e) => {
    e.preventDefault();
    if (!newContestName) return alert("官方赛季名称不得为空！");
    const systemGeneratedId = 'ct_' + Math.random().toString(36).substring(2, 10) + '_' + Date.now().toString().slice(-4);
    try {
      addLog(`🏗️ 正在云端自动化创生赛季: [${systemGeneratedId}]...`);
      const { error } = await supabase.from('contests').insert({
        id: systemGeneratedId, name: newContestName, description: newContestDesc
      });
      if (error) throw error;
      addLog(`✅ 赛季资产铸造成功！系统已锁定识别码: ${systemGeneratedId}`);
      setNewContestName(''); setNewContestDesc(''); setShowCreateForm(false);
      fetchContestMetadata();
    } catch (err) { alert("创生新赛季失败: " + err.message); }
  };

  const handleSwitchGlobalActiveContest = async () => {
    if (!selectedContestId) return;
    const targetContest = contests.find(c => c.id === selectedContestId);
    if (!targetContest) return;
    try {
      addLog(`🎯 正在执行全局赛季权力交割...`);
      const { data, error } = await supabase.from('site_settings').update({ 
        current_contest_id: selectedContestId, is_contest_active: true
      }).eq('id', 1).select();
      if (error) throw error;
      if (data && data.length > 0) {
        setActiveContestId(selectedContestId); setIsContestActive(true);
        addLog(`🎉 全网前台已同步聚焦于主赛场：【${targetContest.name}】`);
        alert(`已成功推举【${targetContest.name}】为主赛事！`);
      }
    } catch (err) { addLog(`❌ 交割失败: ${err.message}`); }
  };

  const handleToggleContestActive = async () => {
    const nextStatus = !isContestActive;
    try {
      addLog(`🎛️ 正在将当前主赛事准入大闸调整为: ${nextStatus ? '🟢 开启' : '🔴 关闭'}...`);
      const { data, error } = await supabase.from('site_settings').update({ is_contest_active: nextStatus }).eq('id', 1).select();
      if (error) throw error;
      if (data && data.length > 0) {
        setIsContestActive(data[0].is_contest_active);
        addLog(`✅ 大闸同步成功！当前全网状态：${data[0].is_contest_active ? '激活中' : '休眠中'}`);
      }
    } catch (err) { addLog(`❌ 切换失败: ${err.message}`); }
  };

  const handleSaveTime = async () => {
    try {
      addLog("⏳ 正在同步截稿时间与展厅大闸至云端...");
      const { error } = await supabase
        .from('contests')
        .update({
          submission_deadline: galleryTime.deadline ? new Date(galleryTime.deadline).toISOString() : null,
          gallery_start_time: galleryTime.start ? new Date(galleryTime.start).toISOString() : null,
          gallery_end_time: galleryTime.end ? new Date(galleryTime.end).toISOString() : null
        })
        .eq('id', selectedContestId);

      if (error) throw error;
      addLog("✅ 该赛季的截稿防线与数字展厅展期已成功锁定！");
      alert("时空大闸配置成功！");
    } catch (err) {
      addLog(`❌ 时间同步失败: ${err.message}`);
    }
  };

  const handleStartReviewEngine = async () => {
    setIsReviewing(true); addLog("⚡ 向中控台发送唤醒指令...");
    try {
      const res = await fetch(`${API_BASE}/admin/engine/start-review`, { method: 'POST' });
      const data = await res.json();
      if (data.status === 'success') addLog("🤖 [SUCCESS] Agent 正在消耗待审队列...");
    } catch (err) { addLog(`❌ 引擎唤醒失败: ${err.message}`); } 
    finally { setIsReviewing(false); setTimeout(() => fetchDashboardData(selectedContestId), 3000); }
  };

  const handleRunGlobalCuration = async () => {
    setIsCurating(true); addLog("📊 正在下达离线全局决算指令...");
    try {
      const res = await fetch(`${API_BASE}/admin/engine/run-curation`, { method: 'POST' });
      const data = await res.json();
      if (data.status === 'success') addLog("🏆 [SUCCESS] 动态策展执行完毕！");
    } catch (err) { addLog(`❌ 策展执行失败: ${err.message}`); } 
    finally { setIsCurating(false); fetchDashboardData(selectedContestId); }
  };

  const handleToggleManualRecommend = async (id, currentStatus) => {
    try {
      const nextStatus = !currentStatus;
      const { data, error = null } = await supabase.from('contest_submissions').update({ is_manual_recommended: nextStatus }).eq('id', id).select();
      if (error) throw error;
      if (!data || data.length === 0) { addLog(`❌ 推举失败：权限拦截。`); return; }
      addLog(`💎 作品 [${id.substring(0,8)}] 推举已变更为: ${nextStatus ? '开启' : '关闭'}`);
      fetchDashboardData(selectedContestId);
    } catch (err) { addLog(`❌ 推举失败: ${err.message}`); }
  };

  const handleUpdateRank = async (id, rankValue) => {
    try {
      const { data, error } = await supabase.from('contest_submissions').update({ manual_rank: parseInt(rankValue, 10) || 0 }).eq('id', id).select();
      if (error) throw error;
      if (!data || data.length === 0) { addLog(`❌ 权重修正失败：权限拦截。`); return; }
      addLog(`🎯 作品 [${id.substring(0,8)}] 权重修正为: ${rankValue}`);
    } catch (err) { console.error(err); }
  };

  const handleLogout = async () => { await supabase.auth.signOut(); window.location.reload(); };

  const handleContestSelectionChange = (e) => {
    const cid = e.target.value;
    setSelectedContestId(cid);
    fetchDashboardData(cid);
    syncTimeState(cid, contests);
  };

  return (
    <div style={{ padding: '30px', backgroundColor: '#0a0a0a', minHeight: '100vh', color: '#e0e0e0', fontFamily: 'monospace' }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #333', paddingBottom: '15px', marginBottom: '30px' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: '24px', color: '#fff' }}>🏛️ NAL 中央管理台</h1>
          <p style={{ margin: '5px 0 0 0', color: '#888', fontSize: '13px' }}>算法共治与离线全局策展</p>
        </div>
        <button onClick={handleLogout} style={{ padding: '8px 16px', backgroundColor: '#bf616a', color: '#fff', border: 'none', cursor: 'pointer', fontWeight: 'bold' }}>
          退出登入
        </button>
      </header>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '25px', marginBottom: '30px' }}>
        
        {/* 多赛季全局中控 */}
        <div style={{ padding: '20px', background: '#111', border: '1px solid #222', borderRadius: '4px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '15px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <h3 style={{ margin: 0, color: '#ebcb8b' }}>📅 当前调度赛季视角:</h3>
              <select value={selectedContestId} onChange={handleContestSelectionChange} style={{ padding: '8px 12px', background: '#222', color: '#fff', border: '1px solid #444', fontFamily: 'monospace', cursor: 'pointer', fontSize: '14px' }}>
                {contests.map(c => <option key={c.id} value={c.id}>{c.name} {c.id === activeContestId ? " 🟢 [激活]" : ""}</option>)}
              </select>
            </div>
            <div style={{ display: 'flex', gap: '10px' }}>
              {selectedContestId !== activeContestId && (
                <button onClick={handleSwitchGlobalActiveContest} style={{ padding: '8px 16px', backgroundColor: '#d08770', color: '#fff', border: 'none', cursor: 'pointer', fontWeight: 'bold' }}>🚀 推举为全局主赛场</button>
              )}
              <button onClick={() => setShowCreateForm(!showCreateForm)} style={{ padding: '8px 16px', backgroundColor: '#5e81ac', color: '#fff', border: 'none', cursor: 'pointer', fontWeight: 'bold' }}>
                {showCreateForm ? "收起" : "➕ 筹备新赛季"}
              </button>
            </div>
          </div>

          {showCreateForm && (
            <form onSubmit={handleCreateNewContest} style={{ marginTop: '20px', borderTop: '1px dashed #333', paddingTop: '20px' }}>
              <div style={{ marginBottom: '15px' }}>
                <label style={{ display: 'block', marginBottom: '5px', color: '#888' }}>赛季名称:</label>
                <input type="text" value={newContestName} onChange={e => setNewContestName(e.target.value)} style={{ width: '100%', maxWidth: '600px', padding: '8px', background: '#222', color: '#fff', border: '1px solid #444' }} />
              </div>
              <div style={{ marginBottom: '15px' }}>
                <label style={{ display: 'block', marginBottom: '5px', color: '#888' }}>章程宣发文案:</label>
                <textarea value={newContestDesc} onChange={e => setNewContestDesc(e.target.value)} rows={3} style={{ width: '100%', maxWidth: '600px', padding: '8px', background: '#222', color: '#fff', border: '1px solid #444' }} />
              </div>
              <button type="submit" style={{ padding: '8px 24px', backgroundColor: '#a3be8c', color: '#000', border: 'none', cursor: 'pointer', fontWeight: 'bold' }}>🔨 确认铸造新赛季</button>
            </form>
          )}

          <div style={{ marginTop: '20px', paddingTop: '15px', borderTop: '1px solid #222', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ color: '#888', fontSize: '13px' }}>当前主赛场准入状态：<strong style={{ color: isContestActive ? '#a3be8c' : '#bf616a' }}>{isContestActive ? "🟢 大闸开启中" : "🔴 全网休眠中"}</strong></span>
            {selectedContestId === activeContestId && (
              <button onClick={handleToggleContestActive} style={{ padding: '5px 15px', backgroundColor: isContestActive ? '#bf616a' : '#a3be8c', color: isContestActive ? '#fff' : '#000', border: 'none', cursor: 'pointer', fontWeight: 'bold', fontSize: '12px' }}>
                {isContestActive ? "封印当前大闸" : "激活当前大闸"}
              </button>
            )}
          </div>
        </div>

        {/* 赛事时空大闸 */}
        <div style={{ padding: '20px', background: '#111', border: '1px solid #222', borderRadius: '4px' }}>
          <h3 style={{ margin: '0 0 20px 0', color: '#ebcb8b', display: 'flex', alignItems: 'center', gap: '8px' }}>⏳ 赛事生命周期与展厅时空大闸</h3>
          
          <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
            {/* 第一行：截稿防线 */}
            <div style={{ display: 'flex', alignItems: 'center', paddingBottom: '15px', borderBottom: '1px dashed #333' }}>
              <label style={{ color: '#d08770', fontWeight: 'bold', display: 'flex', alignItems: 'center' }}>
                🔴 前台截稿死线 (截止后转入死库评审，不可提交新稿): 
                <input 
                  type="date" // 🌟 核心修正：类型调整为 date，彻底移除时分选择
                  value={galleryTime.deadline} 
                  onChange={e => setGalleryTime(prev => ({ ...prev, deadline: e.target.value }))} 
                  style={{ marginLeft: '15px', padding: '6px', background: '#222', color: '#fff', border: '1px solid #444', outline: 'none', borderRadius: '4px', fontFamily: 'monospace' }}
                />
              </label>
            </div>

            {/* 第二行：展厅大闸 */}
            <div style={{ display: 'flex', gap: '25px', alignItems: 'center', flexWrap: 'wrap' }}>
              <label style={{ color: '#a3be8c', fontWeight: 'bold', display: 'flex', alignItems: 'center' }}>
                🏛️ 展厅启封日期: 
                <input 
                  type="date" 
                  value={galleryTime.start} 
                  onChange={e => setGalleryTime(prev => ({ ...prev, start: e.target.value }))} 
                  style={{ marginLeft: '10px', padding: '6px', background: '#222', color: '#fff', border: '1px solid #444', outline: 'none', borderRadius: '4px', fontFamily: 'monospace' }}
                />
              </label>
              
              <label style={{ color: '#a3be8c', fontWeight: 'bold', display: 'flex', alignItems: 'center' }}>
                展厅闭馆日期: 
                <input 
                  type="date" 
                  value={galleryTime.end} 
                  onChange={e => setGalleryTime(prev => ({ ...prev, end: e.target.value }))} 
                  style={{ marginLeft: '10px', padding: '6px', background: '#222', color: '#fff', border: '1px solid #444', outline: 'none', borderRadius: '4px', fontFamily: 'monospace' }}
                />
              </label>

              <button 
                onClick={handleSaveTime} 
                style={{ marginLeft: 'auto', padding: '8px 20px', backgroundColor: '#a3be8c', color: '#000', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold' }}
              >
                云端同步锁定
              </button>
            </div>
          </div>
        </div>

        {/* 评审引擎 */}
        <div style={{ padding: '20px', background: '#111', border: '1px solid #222', borderRadius: '4px' }}>
          <h3 style={{ margin: '0 0 15px 0', color: '#88c0d0' }}>⚡ 评审引擎与全局中控</h3>
          <div style={{ display: 'flex', gap: '20px', alignItems: 'center', marginBottom: '20px' }}>
            <div style={{ background: '#222', padding: '10px 20px', borderLeft: '4px solid #bf616a' }}>
              <span style={{ color: '#888' }}>当前视角下待审 (Pending): </span>
              <strong style={{ fontSize: '20px', color: '#bf616a', marginLeft: '10px' }}>{pendingCount}</strong> 篇
            </div>
            <button onClick={handleStartReviewEngine} disabled={isReviewing || pendingCount === 0} style={{ padding: '12px 24px', backgroundColor: pendingCount === 0 ? '#444' : '#5e81ac', color: '#fff', border: 'none', cursor: pendingCount === 0 ? 'not-allowed' : 'pointer', fontWeight: 'bold' }}>{isReviewing ? "🤖 会诊中..." : "⚡ 启动离线评审"}</button>
            <button onClick={handleRunGlobalCuration} disabled={isCurating || works.length === 0} style={{ padding: '12px 24px', backgroundColor: '#d08770', color: '#fff', border: 'none', cursor: 'pointer', fontWeight: 'bold' }}>{isCurating ? "📊 计算中..." : "📊 全局策展划线 (Top 5%)"}</button>
          </div>
          <div style={{ background: '#000', padding: '15px', borderRadius: '4px', height: '120px', overflowY: 'auto', border: '1px solid #333', fontSize: '12px', lineHeight: '1.6' }}>
            {logMessages.length === 0 ? <span style={{ color: '#4c566a' }}>&gt;_ 等待中控调度...</span> : logMessages.map((log, i) => <div key={i} style={{ color: log.includes('❌') ? '#bf616a' : log.includes('✅') || log.includes('SUCCESS') ? '#a3be8c' : '#d8dee9' }}>{log}</div>)}
          </div>
        </div>

        {/* 展厅推荐管理 */}
        <div style={{ padding: '20px', background: '#111', border: '1px solid #222', borderRadius: '4px' }}>
          <h3 style={{ margin: '0 0 15px 0', color: '#b48ead' }}>🏆 展厅作品库选拔（共 {works.length} 篇）</h3>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '13px' }}>
              <thead>
                <tr style={{ borderBottom: '2px solid #333', color: '#888' }}>
                  <th style={{ padding: '10px' }}>作品 UUID</th>
                  <th style={{ padding: '10px' }}>字数</th>
                  <th style={{ padding: '10px' }}>AI 综合均分</th>
                  <th style={{ padding: '10px' }}>专家分歧度 (方差)</th>
                  <th style={{ padding: '10px' }}>主编推举金标</th>
                  <th style={{ padding: '10px' }}>展厅展示权重</th>
                </tr>
              </thead>
              <tbody>
                {works.map((work) => (
                  <tr key={work.id} style={{ borderBottom: '1px solid #222' }}>
                    <td style={{ padding: '10px', color: '#a3be8c' }}>{work.id}</td>
                    <td style={{ padding: '10px' }}>{work.word_count} 字</td>
                    <td style={{ padding: '10px', fontWeight: 'bold', color: '#ebcb8b' }}>{work.ai_total_score?.toFixed(1)}分</td>
                    <td style={{ padding: '10px', color: work.ai_variance > 20 ? '#bf616a' : '#d8dee9' }}>{work.ai_variance?.toFixed(2)}</td>
                    <td style={{ padding: '10px' }}>
                      <button onClick={() => handleToggleManualRecommend(work.id, work.is_manual_recommended)} style={{ padding: '4px 10px', backgroundColor: work.is_manual_recommended ? '#5e81ac' : '#333', color: '#fff', border: 'none', cursor: 'pointer', fontSize: '11px', borderRadius: '4px' }}>
                        {work.is_manual_recommended ? "💎 已推举" : "⚪ 选入展厅"}
                      </button>
                    </td>
                    <td style={{ padding: '10px' }}>
                      <input type="number" defaultValue={work.manual_rank} onBlur={(e) => handleUpdateRank(work.id, e.target.value)} style={{ width: '50px', padding: '4px', background: '#222', color: '#fff', border: '1px solid #444', textAlign: 'center', borderRadius: '4px' }} placeholder="0"/>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

      </div>
    </div>
  );
}
