import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../supabaseClient'; // ⚠️请确保此路径正确指向你的 supabaseClient

export default function HomeContestSection() {
  const navigate = useNavigate();
  const [contestInfo, setContestInfo] = useState({
    isActive: false,
    name: 'NAL 年度精选文学赏', // 默认占位符
    description: ''
  });
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const fetchSettings = async () => {
      try {
        // 📡 直连中控台，拉取最高指令
        const { data, error } = await supabase
          .from('site_settings')
          .select('is_contest_active, contest_name, contest_description')
          .eq('id', 1)
          .single();

        if (!error && data) {
          setContestInfo({
            isActive: data.is_contest_active,
            name: data.contest_name || 'NAL 年度精选文学赏',
            description: data.contest_description || ''
          });
        }
      } catch (err) {
        console.error("加载首页赛事动态失败", err);
      } finally {
        setIsLoading(false);
      }
    };
    fetchSettings();
  }, []);

  if (isLoading) {
    return (
      <div style={{ textAlign: 'center', padding: '60px', color: '#64748b', backgroundColor: '#0a0a0a' }}>
        <span style={{ animation: 'pulse 1.5s infinite' }}>📡 正在同步 NAL 最新赛事数据...</span>
      </div>
    );
  }

  return (
    <section style={{ padding: '80px 20px', backgroundColor: '#0a0a0a', color: '#fff', fontFamily: 'system-ui' }}>
      <div style={{ maxWidth: '800px', margin: '0 auto', textAlign: 'center' }}>
        
        {/* 🌟 核心逻辑 1：无论是否激活，始终威严地展示大赛名称 */}
        <h2 style={{ fontSize: '38px', color: '#fbbf24', marginBottom: '30px', fontWeight: '900', letterSpacing: '-1px' }}>
          {contestInfo.name}
        </h2>

        {contestInfo.isActive ? (
          /* 🌟 核心逻辑 2：激活状态（展示火热的标签、具体章程与入口） */
          <div style={{
            backgroundColor: '#111827',
            border: '1px solid #374151',
            borderRadius: '16px',
            padding: '40px',
            boxShadow: '0 10px 40px rgba(0,0,0,0.5)',
            transition: 'all 0.3s ease'
          }}>
            <div style={{ display: 'inline-block', padding: '6px 16px', background: '#ef4444', color: '#fff', fontSize: '14px', fontWeight: 'bold', borderRadius: '6px', marginBottom: '25px' }}>
              🔥 官方征稿火热进行中
            </div>
            
            <div style={{
              fontSize: '16px', lineHeight: '2.0', color: '#d8dee9',
              textAlign: 'left', whiteSpace: 'pre-wrap', marginBottom: '35px',
              backgroundColor: 'rgba(0,0,0,0.2)', padding: '25px', borderRadius: '12px'
            }}>
              {contestInfo.description}
            </div>
            
            <button
              onClick={() => navigate('/dashboard')}
              style={{
                padding: '16px 40px', backgroundColor: '#10b981', color: '#fff',
                border: 'none', borderRadius: '8px', fontSize: '18px', fontWeight: 'bold',
                cursor: 'pointer', transition: 'transform 0.2s', boxShadow: '0 4px 15px rgba(16, 185, 129, 0.3)'
              }}
              onMouseOver={(e) => e.target.style.transform = 'translateY(-2px)'}
              onMouseOut={(e) => e.target.style.transform = 'translateY(0)'}
            >
              🚀 进入系统 · 立即投稿
            </button>
          </div>
        ) : (
          /* 🌟 核心逻辑 3：休眠状态（隐藏章程，显示高冷占位提示） */
          <div style={{
            backgroundColor: 'rgba(255,255,255,0.02)',
            border: '1px dashed #333',
            borderRadius: '16px',
            padding: '50px 30px'
          }}>
            <div style={{ fontSize: '20px', color: '#6b7280', marginBottom: '15px', fontWeight: 'bold' }}>
              🌙 赛事周期已休眠 / 筹备中
            </div>
            <p style={{ color: '#4b5563', lineHeight: '1.8', margin: '0 auto', maxWidth: '500px' }}>
              本届文学赛事目前暂未开放征稿。详情章程与评审通道已封存。<br/>
              请持续关注 NAL 评审委员会的官方公告，新的文学纪元正在酝酿。
            </p>
            <button
              onClick={() => navigate('/dashboard')}
              style={{
                marginTop: '30px', padding: '12px 28px', backgroundColor: 'transparent',
                color: '#6b7280', border: '1px solid #4b5563', borderRadius: '8px',
                cursor: 'pointer', fontSize: '15px', fontWeight: 'bold'
              }}
              onMouseOver={(e) => { e.target.style.color = '#fff'; e.target.style.borderColor = '#fff'; }}
              onMouseOut={(e) => { e.target.style.color = '#6b7280'; e.target.style.borderColor = '#4b5563'; }}
            >
              前往个人中心
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
