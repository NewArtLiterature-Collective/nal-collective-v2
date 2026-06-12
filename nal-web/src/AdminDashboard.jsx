import React, { useState, useEffect } from 'react';
import { supabase } from './supabaseClient'; // 确保路径与你的项目一致

export default function AdminDashboard() {
  const API_BASE = 'https://nal-api-backend.onrender.com';
  const ADMIN_KEY = 'fq8pJ5M-VwzAyx5TYhxBilmVb25iHIPLlavDPhcCDLU';
  
  // 1. 状态矩阵
  const [galleryTime, setGalleryTime] = useState({ start: '', end: '' });
  const [pendingCount, setPendingCount] = useState(0);
  const [isReviewing, setIsReviewing] = useState(false);
  const [isCurating, setIsCurating] = useState(false);
  const [works, setWorks] = useState([]);
  const [logMessages, setLogMessages] = useState([]);

  // 2. 模拟终端日志打印器
  const addLog = (msg) => {
    const time = new Date().toLocaleTimeString();
    setLogMessages(prev => [`[${time}] ${msg}`, ...prev]);
  };

  // 3. 初始化：拉取待评审统计、展厅作品列表及当前时间设置
  useEffect(() => {
    fetchDashboardData();
    // 🌟 开启 Supabase Realtime 监听大阵
    const subscription = supabase
      .channel('contest-dashboard-radar')
      .on(
        'postgres_changes', 
        { 
          event: 'UPDATE', // 只监听数据的更新操作
          schema: 'public', 
          table: 'contest_submissions' 
        }, 
       (payload) => {
         const targetId = payload.new.id.substring(0, 8);
         const newStatus = payload.new.status;

         if (newStatus === 'processing') {
           addLog(`⏳ [AI 引擎] 已锁定作品 ${targetId}，正在解析...`);
         } else if (newStatus === 'success') {
           addLog(`✅ [实时战报] 作品 ${targetId} 评审完毕！`);
         } else if (newStatus === 'invalid') {
          addLog(`❌ [拦截] 作品 ${targetId} 未达参赛门槛。`);
         }
         // 无论哪种状态变更，都触发数据刷新
         setTimeout(fetchDashboardData, 300);
       }
      )
      .subscribe();

    // 🧹 安全收尾：如果管理员离开或关闭了这个页面，立刻切断监听，防止内存泄漏
    return () => {
      supabase.removeChannel(subscription);
    };
  }, []);
 const fetchDashboardData = async () => {
    try {
      // 1. 侦测 pending 作品 (🚨 已经解除了注释！)
      const { count: fetchedCount, error: pendingError } = await supabase
      .from('contest_submissions')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'pending');

      if (pendingError) {
        console.error("🚨 抓取待审数据被拦截:", pendingError.message);
      }
      setPendingCount(fetchedCount ?? 0);

      // 2. 侦测 success 作品
      const { data: submissions, error: successError } = await supabase
        .from('contest_submissions')
        .select('id, word_count, ai_total_score, ai_variance, is_manual_recommended, manual_rank')
        .eq('status', 'success')
        .order('ai_total_score', { ascending: false });

      if (successError) {
        console.error("🚨 抓取展厅数据被拦截:", successError.message);
      }
      setWorks(submissions || []);

      // 3. 侦测系统时间设置
      const { data: settings, error: settingsError } = await supabase
        .from('site_settings')
        .select('gallery_start_time, gallery_end_time')
        .maybeSingle();
      
      if (settingsError) {
        console.error("🚨 抓取大闸时间失败:", settingsError.message);
      }
      
      if (settings) {
        setGalleryTime({
          start: settings.gallery_start_time ? settings.gallery_start_time.substring(0, 10) : '',
          end: settings.gallery_end_time ? settings.gallery_end_time.substring(0, 10) : ''
        });
      }
    } catch (err) {
      console.error('初始化管理台数据遇到致命级错误:', err);
    }
  };
  
  // 4. 核心调度：保存时空大闸时间
  const handleSaveTime = async () => {
    try {
      addLog("⏳ 正在同步时空大闸至云端...");
      // 调用我们在路由器里写好的 FastAPI 后端接口（假设基准地址为 /api）
      const res = await fetch(`${API_BASE}/admin/settings/gallery-time`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-key': ADMIN_KEY
        },
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

  // 5. 核心调度：一键唤醒后台 AI 评审 Agent 守护进程
  const handleStartReviewEngine = async () => {
    setIsReviewing(true);
    addLog("⚡ 正在向 FastAPI 中控台发送唤醒神令...");
    try {
      const res = await fetch(`${API_BASE}/admin/engine/start-review`, {
          method: 'POST',
          headers: {
            'x-admin-key': ADMIN_KEY
          }
      });
      const data = await res.json();
      if (data.status === 'success') {
        addLog("🤖 [SUCCESS] 后台 AI 评审 Agent 已成功占领内存，正在监听轮询兜底器...");
        addLog("💡 提示：并发评审正在后台静默执行，请定时刷新页面查看 pending 数量递减。");
      }
    } catch (err) {
      addLog(`❌ 引擎唤醒失败: ${err.message}`);
    } finally {
      setIsReviewing(false);
      setTimeout(fetchDashboardData, 3000); // 3秒后自动刷新数据
    }
  };

  // 6. 核心调度：截止后统一触发全局动态策展 (Top 5%)
  const handleRunGlobalCuration = async () => {
    setIsCurating(true);
    addLog("📊 正在下达离线全局总决算指令...");
    try {
      const res = await fetch(`${API_BASE}/admin/engine/run-curation`, {
          method: 'POST',
          headers: {
            'x-admin-key': ADMIN_KEY
          }
      });
      const data = await res.json();
      if (data.status === 'success') {
        addLog("🏆 [SUCCESS] curator_script.py 执行完毕！Top 5% 门槛分数已自动划定，金标写入完成。");
      }
    } catch (err) {
      addLog(`❌ 动态策展执行失败: ${err.message}`);
    } finally {
      setIsCurating(false);
      fetchDashboardData();
    }
  };

  // 7. 核心调度：手动更动“主编推荐”状态与权重排序
  const handleToggleManualRecommend = async (id, currentStatus) => {
    try {
      const nextStatus = !currentStatus;
      const { error } = await supabase
        .from('contest_submissions')
        .update({ is_manual_recommended: nextStatus })
        .eq('id', id);

      if (!error) {
        addLog(`💎 作品 [${id.substring(0,8)}] 主编推荐状态已变更为: ${nextStatus ? '开启' : '关闭'}`);
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

      if (!error) {
        addLog(`🎯 作品 [${id.substring(0,8)}] 展厅展示权重已修正为: ${rankValue}`);
      }
    } catch (err) {
      console.error(err);
    }
  };

  // 8. 登出安全退出
  const handleLogout = async () => {
    await supabase.auth.signOut();
    window.location.reload();
  };

  return (
    <div style={{ padding: '30px', backgroundColor: '#0a0a0a', minHeight: '100vh', color: '#e0e0e0', fontFamily: 'monospace' }}>
      {/* 顶部通栏 */}
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #333', paddingBottom: '15px', marginBottom: '30px' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: '24px', color: '#fff' }}>🏛️ NAL 新艺文社数字化文学平台 · 中央管理台</h1>
          <p style={{ margin: '5px 0 0 0', color: '#888', fontSize: '13px' }}>算法共治与离线全局策展核心中控系统</p>
        </div>
        <button onClick={handleLogout} style={{ padding: '8px 16px', backgroundColor: '#bf616a', color: '#fff', border: 'none', cursor: 'pointer', fontWeight: 'bold' }}>
          退出登入安全撤离
        </button>
      </header>

      {/* 控制中心主矩阵 */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '25px', marginBottom: '30px' }}>
        
        {/* 模块 1：赛事时空大闸 */}
        <div style={{ padding: '20px', background: '#111', border: '1px solid #222', borderRadius: '4px' }}>
          <h3 style={{ margin: '0 0 15px 0', color: '#ebcb8b', display: 'flex', alignItems: 'center', gap: '8px' }}>⏳ 赛事时空大闸（Exhibition Time-Gate）</h3>
          <div style={{ display: 'flex', gap: '20px', alignItems: 'center', flexWrap: 'wrap' }}>
            <label>
              展厅开启日期: 
              <input 
                type="date" 
                value={galleryTime.start} 
                onChange={e => setGalleryTime(prev => ({ ...prev, start: e.target.value }))}
                style={{ marginLeft: '10px', padding: '6px', background: '#222', color: '#fff', border: '1px solid #444' }}
              />
            </label>
            <label>
              展厅闭馆日期: 
              <input 
                type="date" 
                value={galleryTime.end} 
                onChange={e => setGalleryTime(prev => ({ ...prev, end: e.target.value }))}
                style={{ marginLeft: '10px', padding: '6px', background: '#222', color: '#fff', border: '1px solid #444' }}
              />
            </label>
            <button onClick={handleSaveTime} style={{ padding: '7px 15px', backgroundColor: '#a3be8c', color: '#000', border: 'none', cursor: 'pointer', fontWeight: 'bold' }}>
              同步锁定时间
            </button>
          </div>
        </div>

        {/* 模块 2：评审引擎与全局策展调度 */}
        <div style={{ padding: '20px', background: '#111', border: '1px solid #222', borderRadius: '4px' }}>
          <h3 style={{ margin: '0 0 15px 0', color: '#88c0d0' }}>⚡ 评审引擎与全局选拔中控</h3>
          <div style={{ display: 'flex', gap: '20px', alignItems: 'center', marginBottom: '20px' }}>
            <div style={{ background: '#222', padding: '10px 20px', borderLeft: '4px solid #bf616a' }}>
              <span style={{ color: '#888' }}>当前池内待评审作品（Pending）: </span>
              <strong style={{ fontSize: '20px', color: '#bf616a', marginLeft: '10px' }}>{pendingCount}</strong> 篇
            </div>
            <button 
              onClick={handleStartReviewEngine} 
              disabled={isReviewing || pendingCount === 0}
              style={{ 
                padding: '12px 24px', 
                backgroundColor: isReviewing ? '#5e81ac' : pendingCount === 0 ? '#2d6a4f' : '#5e81ac', 
                color: '#fff', border: 'none', 
                cursor: pendingCount === 0 ? 'not-allowed' : 'pointer', 
                fontWeight: 'bold' 
              }}
            >
              {isReviewing ? "🤖 专家组会诊中..." : pendingCount === 0 ? "✅ 评审已全部完成" : "⚡ 启动全量离线评审"}
            </button> 
            <button 
              onClick={handleRunGlobalCuration} 
              disabled={isCurating || works.length === 0}
              style={{ padding: '12px 24px', backgroundColor: '#d08770', color: '#fff', border: 'none', cursor: 'pointer', fontWeight: 'bold' }}
            >
              {isCurating ? "📊 计算百分位中..." : "📊 执行全局动态策展 (Top 5%)"}
            </button>
          </div>

          {/* 实时仿真控制台日志 */}
          <div style={{ background: '#000', padding: '15px', borderRadius: '4px', height: '120px', overflowY: 'auto', border: '1px solid #333', fontSize: '12px', lineHeight: '1.6' }}>
            {logMessages.length === 0 ? (
              <span style={{ color: '#4c566a' }}>&gt;_ 控制台暂无核心指令输出，等待中控调度...</span>
            ) : (
              logMessages.map((log, i) => <div key={i} style={{ color: log.includes('❌') ? '#bf616a' : log.includes('✅') || log.includes('SUCCESS') ? '#a3be8c' : '#d8dee9' }}>{log}</div>)
            )}
          </div>
        </div>

        {/* 模块 3：展厅人工推举与权重拣选 */}
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
                  <tr key={work.id} style={{ borderBottom: '1px solid #222', hover: { background: '#222' } }}>
                    <td style={{ padding: '10px', color: '#a3be8c' }}>{work.id}</td>
                    <td style={{ padding: '10px' }}>{work.word_count} 字</td>
                    <td style={{ padding: '10px', fontWeight: 'bold', color: '#ebcb8b' }}>{work.ai_total_score?.toFixed(1)}分</td>
                    <td style={{ padding: '10px', color: work.ai_variance > 20 ? '#bf616a' : '#d8dee9' }}>{work.ai_variance?.toFixed(2)}</td>
                    <td style={{ padding: '10px' }}>
                      <button 
                        onClick={() => handleToggleManualRecommend(work.id, work.is_manual_recommended)}
                        style={{ padding: '4px 10px', backgroundColor: work.is_manual_recommended ? '#5e81ac' : '#333', color: '#fff', border: 'none', cursor: 'pointer', fontSize: '11px' }}
                      >
                        {work.is_manual_recommended ? "💎 已推举" : "⚪ 选入展厅"}
                      </button>
                    </td>
                    <td style={{ padding: '10px' }}>
                      <input 
                        type="number" 
                        defaultValue={work.manual_rank} 
                        onBlur={(e) => handleUpdateRank(work.id, e.target.value)}
                        style={{ width: '50px', padding: '3px', background: '#222', color: '#fff', border: '1px solid #444', textAlign: 'center' }}
                        placeholder="0"
                      />
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
