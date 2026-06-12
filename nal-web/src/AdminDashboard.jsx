import React, { useState, useEffect } from 'react';
import { supabase } from './supabaseClient'; 

export default function AdminDashboard() {
  const API_BASE = 'https://nal-api-backend.onrender.com';
  
  // 1. 状态矩阵
  const [galleryTime, setGalleryTime] = useState({ start: '', end: '' });
  const [pendingCount, setPendingCount] = useState(0);
  const [isReviewing, setIsReviewing] = useState(false);
  const [isCurating, setIsCurating] = useState(false);
  const [works, setWorks] = useState([]);
  const [logMessages, setLogMessages] = useState([]);

  // 🌟 新增：赛事管理核心状态
  const [isContestActive, setIsContestActive] = useState(false);
  const [contestName, setContestName] = useState('');
  const [contestDescription, setContestDescription] = useState('');
  const [isSavingDetails, setIsSavingDetails] = useState(false);

  const addLog = (msg) => {
    const time = new Date().toLocaleTimeString();
    setLogMessages(prev => [`[${time}] ${msg}`, ...prev]);
  };

  useEffect(() => {
    fetchDashboardData();
    const subscription = supabase
      .channel('contest-dashboard-radar')
      .on(
        'postgres_changes', 
        { event: 'UPDATE', schema: 'public', table: 'contest_submissions' }, 
        (payload) => {
          const targetId = payload.new.id.substring(0, 8);
          if (payload.old.status === 'pending' && payload.new.status === 'processing') {
             addLog(`⏳ [AI 引擎] 已锁定作品 ${targetId}，正在进行多模态解析...`);
             fetchDashboardData(); 
          }
          if (payload.new.status === 'success' && payload.old.status !== 'success') {
             addLog(`✅ [实时战报] 作品 ${targetId} 评审完毕！入库成功。`);
             setTimeout(fetchDashboardData, 500); 
          }
          if (payload.new.status === 'invalid') {
             addLog(`❌ [拦截] 作品 ${targetId} 未达参赛门槛，已自动拦截。`);
             fetchDashboardData();
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(subscription);
    };
  }, []);

  const fetchDashboardData = async () => {
    try {
      const { count: pendingCount, error: pendingError } = await supabase
        .from('contest_submissions')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'pending');
      if (pendingError) console.error("🚨 抓取待审数据被拦截:", pendingError.message);
      setPendingCount(pendingCount || 0);

      const { data: submissions, error: successError } = await supabase
        .from('contest_submissions')
        .select('id, word_count, ai_total_score, ai_variance, is_manual_recommended, manual_rank')
        .eq('status', 'success')
        .order('ai_total_score', { ascending: false });
      if (successError) console.error("🚨 抓取展厅数据被拦截:", successError.message);
      setWorks(submissions || []);

      // 🌟 获取时间大闸的同时，一并拉取全局赛事状态
      const { data: settings, error: settingsError } = await supabase
        .from('site_settings')
        .select('gallery_start_time, gallery_end_time, is_contest_active, contest_name, contest_description')
        .maybeSingle();
      
      if (settingsError) console.error("🚨 抓取全局系统设置失败:", settingsError.message);
      
      if (settings) {
        setGalleryTime({
          start: settings.gallery_start_time ? settings.gallery_start_time.substring(0, 10) : '',
          end: settings.gallery_end_time ? settings.gallery_end_time.substring(0, 10) : ''
        });
        // 装填赛事状态
        setIsContestActive(settings.is_contest_active || false);
        setContestName(settings.contest_name || '');
        setContestDescription(settings.contest_description || '');
      }
    } catch (err) {
      console.error('初始化管理台数据遇到致命级错误:', err);
    }
  };

  // 🌟 核心控制：赛事总开关 (精确命中 id=1)
  const handleToggleContestActive = async () => {
    const nextStatus = !isContestActive;
    try {
      addLog(`🎛️ 正在将赛事全局开关调整为: ${nextStatus ? '🟢 开启' : '🔴 休眠'}...`);
      const { error } = await supabase
        .from('site_settings')
        .update({ is_contest_active: nextStatus })
        .eq('id', 1);

      if (!error) {
        setIsContestActive(nextStatus);
        addLog(`✅ 赛事全局开关已成功同步至云端！状态：${nextStatus ? '激活' : '休眠'}`);
      } else throw error;
    } catch (err) {
      addLog(`❌ 切换赛事开关失败: ${err.message}`);
    }
  };

  // 🌟 核心控制：保存赛事名称与文案 (精确命中 id=1)
  const handleSaveContestDetails = async () => {
    setIsSavingDetails(true);
    addLog("⏳ 正在向云端数据库写入赛事文案资产...");
    try {
      const { error } = await supabase
        .from('site_settings')
        .update({
          contest_name: contestName,
          contest_description: contestDescription
        })
        .eq('id', 1);

      if (!error) {
        addLog(`✅ 赛事基本信息锁定成功！当前主赛事：【${contestName}】`);
        alert("赛事管理配置已成功锁定！");
      } else throw error;
    } catch (err) {
      addLog(`❌ 赛事信息同步失败: ${err.message}`);
    } finally {
      setIsSavingDetails(false);
    }
  };

  const handleSaveTime = async () => {
    try {
      addLog("⏳ 正在同步时空大闸至云端...");
      const res = await fetch(`${API_BASE}/admin/settings/gallery-time`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ start_time: galleryTime.start, end_time: galleryTime.end })
      });
      const data = await res.json();
      if (data.status === 'success') {
        addLog("✅ 数字化展厅展示时间区间已成功锁定！");
        alert("时空大闸配置成功！");
      }
    } catch (err) {
      addLog(`❌ 时间同步失败: ${err.message}`);
    }
  };

  const handleStartReviewEngine = async () => {
    setIsReviewing(true);
    addLog("⚡ 正在向 FastAPI 中控台发送唤醒神令...");
    try {
      const res = await fetch(`${API_BASE}/admin/engine/start-review`, { method: 'POST' });
      const data = await res.json();
      if (data.status === 'success') {
        addLog("🤖 [SUCCESS] 后台 AI 评审 Agent 已成功占领内存，开始批处理...");
      }
    } catch (err) {
      addLog(`❌ 引擎唤醒失败: ${err.message}`);
    } finally {
      setIsReviewing(false);
    }
  };

  const handleRunGlobalCuration = async () => {
    setIsCurating(true);
    addLog("📊 正在下达离线全局总决算指令...");
    try {
      const res = await fetch(`${API_BASE}/admin/engine/run-curation`, { method: 'POST' });
      const data = await res.json();
      if (data.status === 'success') addLog("🏆 [SUCCESS] Top 5% 门槛分数已自动划定，金标写入完成。");
    } catch (err) {
      addLog(`❌ 动态策展执行失败: ${err.message}`);
    } finally {
      setIsCurating(false);
      fetchDashboardData();
    }
  };

  const handleToggleManualRecommend = async (id, currentStatus) => {
    try {
      const nextStatus = !currentStatus;
      const { error } = await supabase
        .from('contest_submissions')
        .update({ is_manual_recommended: nextStatus })
        .eq('id', id);
      if (!error) {
        addLog(`💎 作品 [${id.substring(0,8)}] 主编推荐已变更为: ${nextStatus ? '开启' : '关闭'}`);
        fetchDashboardData();
      }
    } catch (err) {
      addLog(`❌ 手动推举失败: ${err.message}`);
    }
  };

  const handleUpdateRank = async (id, rankValue) => {
    try {
      const { error } = await supabase
        .from('contest_submissions')
        .update({ manual_rank: parseInt(rankValue, 10) || 0 })
        .eq('id', id);
      if (!error) addLog(`🎯 作品 [${id.substring(0,8)}] 展厅展示权重已修正为: ${rankValue}`);
    } catch (err) {
      console.error(err);
    }
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    window.location.reload();
  };

  return (
    <div style={{ padding: '30px', backgroundColor: '#0a0a0a', minHeight: '100vh', color: '#e0e0e0', fontFamily: 'monospace' }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #333', paddingBottom: '15px', marginBottom: '30px' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: '24px', color: '#fff' }}>🏛️ NAL 新艺文社数字化文学平台 · 中央管理台</h1>
          <p style={{ margin: '5px 0 0 0', color: '#888', fontSize: '13px' }}>算法共治与离线全局策展核心中控系统</p>
        </div>
        <button onClick={handleLogout} style={{ padding: '8px 16px', backgroundColor: '#bf616a', color: '#fff', border: 'none', cursor: 'pointer', fontWeight: 'bold' }}>
          退出登入安全撤离
        </button>
      </header>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '25px', marginBottom: '30px' }}>
        
        {/* 🌟 模块 1：赛事全局主控开关 */}
        <div style={{ padding: '20px', background: '#111', border: '1px solid #222', borderRadius: '4px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: isContestActive ? '20px' : '0px' }}>
            <h3 style={{ margin: 0, color: '#d8dee9', display: 'flex', alignItems: 'center', gap: '8px' }}>🎛️ 核心赛事准入控制中枢</h3>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <span style={{ color: isContestActive ? '#a3be8c' : '#bf616a', fontWeight: 'bold' }}>
                {isContestActive ? "[ ACTIVE / 赛事进行中 ]" : "[ SLEEP / 赛事关闭中 ]"}
              </span>
              <button 
                onClick={handleToggleContestActive} 
                style={{ 
                  padding: '6px 16px', 
                  backgroundColor: isContestActive ? '#bf616a' : '#a3be8c', 
                  color: isContestActive ? '#fff' : '#000', 
                  border: 'none', 
                  cursor: 'pointer', 
                  fontWeight: 'bold' 
                }}
              >
                {isContestActive ? "强行封印赛事" : "一键激活赛事"}
              </button>
            </div>
          </div>

          {/* 🌟 模块 1.5：赛事详情配置窗口 (仅在激活时展开) */}
          {isContestActive && (
            <div style={{ borderTop: '1px solid #2d323b', paddingTop: '20px', marginTop: '10px' }}>
              <h4 style={{ margin: '0 0 15px 0', color: '#ebcb8b' }}>📝 数字化赛事详情设定</h4>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
                <div>
                  <label style={{ display: 'block', marginBottom: '5px', color: '#888' }}>当前主赛事名称 (Contest Name):</label>
                  <input 
                    type="text"
                    value={contestName}
                    onChange={e => setContestName(e.target.value)}
                    placeholder="例如：2026 第一届『老儿童』先锋文学大赏..."
                    style={{ width: '100%', maxWidth: '600px', padding: '8px', background: '#222', color: '#fff', border: '1px solid #444', fontFamily: 'monospace' }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', marginBottom: '5px', color: '#888' }}>赛事征稿宣章/描述 (Contest Description):</label>
                  <textarea 
                    value={contestDescription}
                    onChange={e => setContestDescription(e.target.value)}
                    placeholder="请输入赛事章程、评审门槛等基础描述文案..."
                    rows={3}
                    style={{ width: '100%', maxWidth: '600px', padding: '8px', background: '#222', color: '#fff', border: '1px solid #444', fontFamily: 'monospace', resize: 'vertical' }}
                  />
                </div>
                <div>
                  <button 
                    onClick={handleSaveContestDetails}
                    disabled={isSavingDetails || !contestName}
                    style={{ padding: '8px 20px', backgroundColor: '#ebcb8b', color: '#000', border: 'none', cursor: (!contestName || isSavingDetails) ? 'not-allowed' : 'pointer', fontWeight: 'bold' }}
                  >
                    {isSavingDetails ? "📡 同步中..." : "保存赛事详情"}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* 模块 2：赛事时空大闸 */}
        <div style={{ padding: '20px', background: '#111', border: '1px solid #222', borderRadius: '4px' }}>
          <h3 style={{ margin: '0 0 15px 0', color: '#ebcb8b', display: 'flex', alignItems: 'center', gap: '8px' }}>⏳ 赛事时空大闸（Exhibition Time-Gate）</h3>
          <div style={{ display: 'flex', gap: '20px', alignItems: 'center', flexWrap: 'wrap' }}>
            <label>
              展厅开启日期: 
              <input type="date" value={galleryTime.start} onChange={e => setGalleryTime(prev => ({ ...prev, start: e.target.value }))} style={{ marginLeft: '10px', padding: '6px', background: '#222', color: '#fff', border: '1px solid #444' }}/>
            </label>
            <label>
              展厅闭馆日期: 
              <input type="date" value={galleryTime.end} onChange={e => setGalleryTime(prev => ({ ...prev, end: e.target.value }))} style={{ marginLeft: '10px', padding: '6px', background: '#222', color: '#fff', border: '1px solid #444' }}/>
            </label>
            <button onClick={handleSaveTime} style={{ padding: '7px 15px', backgroundColor: '#a3be8c', color: '#000', border: 'none', cursor: 'pointer', fontWeight: 'bold' }}>同步锁定时间</button>
          </div>
        </div>

        {/* 模块 3：评审引擎与全局策展调度 */}
        <div style={{ padding: '20px', background: '#111', border: '1px solid #222', borderRadius: '4px' }}>
          <h3 style={{ margin: '0 0 15px 0', color: '#88c0d0' }}>⚡ 评审引擎与全局选拔中控</h3>
          <div style={{ display: 'flex', gap: '20px', alignItems: 'center', marginBottom: '20px' }}>
            <div style={{ background: '#222', padding: '10px 20px', borderLeft: '4px solid #bf616a' }}>
              <span style={{ color: '#888' }}>当前池内待评审作品（Pending）: </span>
              <strong style={{ fontSize: '20px', color: '#bf616a', marginLeft: '10px' }}>{pendingCount}</strong> 篇
            </div>
            <button onClick={handleStartReviewEngine} disabled={isReviewing || pendingCount === 0} style={{ padding: '12px 24px', backgroundColor: pendingCount === 0 ? '#444' : '#5e81ac', color: '#fff', border: 'none', cursor: pendingCount === 0 ? 'not-allowed' : 'pointer', fontWeight: 'bold' }}>
              {isReviewing ? "🤖 专家组会诊中..." : "⚡ 启动全量离线评审"}
            </button>
            <button onClick={handleRunGlobalCuration} disabled={isCurating || works.length === 0} style={{ padding: '12px 24px', backgroundColor: '#d08770', color: '#fff', border: 'none', cursor: 'pointer', fontWeight: 'bold' }}>
              {isCurating ? "📊 计算百分位中..." : "📊 执行全局动态策展 (Top 5%)"}
            </button>
          </div>
          <div style={{ background: '#000', padding: '15px', borderRadius: '4px', height: '120px', overflowY: 'auto', border: '1px solid #333', fontSize: '12px', lineHeight: '1.6' }}>
            {logMessages.length === 0 ? <span style={{ color: '#4c566a' }}>&gt;_ 控制台暂无核心指令输出，等待中控调度...</span> : logMessages.map((log, i) => <div key={i} style={{ color: log.includes('❌') ? '#bf616a' : log.includes('✅') || log.includes('SUCCESS') ? '#a3be8c' : '#d8dee9' }}>{log}</div>)}
          </div>
        </div>

        {/* 模块 4：展厅人工推举与权重拣选 */}
        <div style={{ padding: '20px', background: '#111', border: '1px solid #222', borderRadius: '4px' }}>
          <h3 style={{ margin: '0 0 15px 0', color: '#b48ead' }}>🏆 展厅作品库选拔（已评审通过共 {works.length} 篇）</h3>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '13px' }}>
              <thead>
                <tr style={{ borderBottom: '2px solid #333', color: '#888' }}>
                  <th style={{ padding: '10px' }}>作品 UUID</th>
                  <th style={{ padding: '10px' }}>字数</th>
                  <th style={{ padding: '10px' }}>AI 综合均分</th>
                  <th style={{ padding: '10px' }}>专家分歧度 (方差)</th>
                  <th style={{ padding: '10px' }}>主编推荐状态</th>
                  <th style={{ padding: '10px' }}>展厅展示权重 (Rank)</th>
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
                      <button onClick={() => handleToggleManualRecommend(work.id, work.is_manual_recommended)} style={{ padding: '4px 10px', backgroundColor: work.is_manual_recommended ? '#5e81ac' : '#333', color: '#fff', border: 'none', cursor: 'pointer', fontSize: '11px' }}>
                        {work.is_manual_recommended ? "💎 已推举" : "⚪ 选入展厅"}
                      </button>
                    </td>
                    <td style={{ padding: '10px' }}>
                      <input type="number" defaultValue={work.manual_rank} onBlur={(e) => handleUpdateRank(work.id, e.target.value)} style={{ width: '50px', padding: '3px', background: '#222', color: '#fff', border: '1px solid #444', textAlign: 'center' }} placeholder="0"/>
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
