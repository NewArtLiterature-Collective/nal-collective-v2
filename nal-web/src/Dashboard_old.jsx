import React, { useState, useEffect } from 'react';
import { supabase } from './supabaseClient';
import { usePayment } from './hooks/usePayment';
import { useEvaluation } from './hooks/useEvaluation';

export default function Dashboard({ session }) {
  const [activeTab, setActiveTab] = useState('text'); 
  const [workText, setWorkText] = useState('');
  const [selectedImages, setSelectedImages] = useState([]);
  const [selectedDocx, setSelectedDocx] = useState(null); 

  const [models, setModels] = useState([]);
  const [selectedModelId, setSelectedModelId] = useState('');
  const [imageType, setImageType] = useState('illustration'); 

  const [userMetadata, setUserMetadata] = useState(session.user.user_metadata || {});
  const userRole = userMetadata.role || (userMetadata.is_paid ? 'contestant' : 'free');
  const isPro = userRole === 'pro';
  const isContestant = userRole === 'contestant';
  
  const [usage, setUsage] = useState({ flash: 0, guide_pro: 0, text_pro: 0, illustration_pro: 0 });

  const { payLoading, loadingPlan, handlePayment } = usePayment();
  const { loading, report, evaluate } = useEvaluation(userRole, usage);

  const refreshUserMetadata = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      const meta = user.user_metadata || {};
      setUserMetadata(meta);
      setUsage({
        flash: meta.flash_left !== undefined ? meta.flash_left : 5,
        guide_pro: meta.guide_pro || 0,
        text_pro: meta.text_pro || 0,
        illustration_pro: meta.illustration_pro || 0
      });
    }
  };

  useEffect(() => {
    refreshUserMetadata();
    const fetchModels = async () => {
      const { data } = await supabase.from('evaluation_models').select('id, name');
      if (data) {
        let filtered = isPro ? data : data.filter(m => m.name.includes('全景综合') || m.name.includes('首席专家'));
        setModels(filtered);
        
        // 🚨 修复：将“NAL-首席专家锐评模型”设为默认选项
        const defaultModel = filtered.find(m => m.name.includes('首席专家'));
        if (defaultModel) {
            setSelectedModelId(defaultModel.id);
        } else if (filtered.length > 0) {
            setSelectedModelId(filtered[0].id);
        }
      }
    };
    fetchModels();

    const params = new URLSearchParams(window.location.search);
    if (params.get('session_id')) {
      window.history.replaceState({}, document.title, window.location.pathname);
      window.location.reload(); 
    }
  }, [userRole, isPro]);

  const handleImageChange = (e) => {
    const files = Array.from(e.target.files);
    // 🚨 终极修复：严格对齐三级火箭权限（Pro 50张，参赛 5张，免费 2张）
    const max = isPro ? 50 : (isContestant ? 5 : 2);
    
    if (files.length > max) {
      return alert(`数量超限！您当前身份最多只能上传 ${max} 张图片。`);
    }
    setSelectedImages(files);
  };

  const handleDocxChange = (e) => {
    if (e.target.files.length > 0) {
      setSelectedDocx(e.target.files[0]); 
    }
  };

  const triggerEvaluation = async () => {
    const success = await evaluate({
      activeTab, workText, selectedImages, selectedDocx, imageType, selectedModelId
    });
    if (success) {
      setWorkText(''); 
      setTimeout(refreshUserMetadata, 1500);
    }
  };

  const engine = (() => {
    if (isPro) return { name: '专业', tag: '专业版' };
    return { name: '高级', tag: '基础版' };
  })();

  const getUploadLimitDesc = () => {
    if (isPro) return "支持最大 200MB 的 .docx 文档";
    if (isContestant) return "支持最大 150KB 的 .docx 文档";
    return "支持最大 50KB 的 .docx 文档";
  };

  const getImageLimitDesc = () => {
    if (isPro) return "支持最多 50 张，单张最大 5MB";
    if (isContestant) return "支持最多 5 张，单张最大 1.5MB";
    return "支持最多 2 张，单张最大 1MB";
  };

  return (
    <div style={styles.dashboard}>
      <aside style={styles.sidebar}>
        <div>
          <h2 style={styles.logo}>NAL Collective</h2>
          <nav style={styles.nav}>
            <button onClick={() => setActiveTab('guide')} style={activeTab === 'guide' ? styles.navActive : styles.navBtn}>💡 创作指导</button>
            <button onClick={() => setActiveTab('text')} style={activeTab === 'text' ? styles.navActive : styles.navBtn}>📝 文字评审</button>
            <button onClick={() => setActiveTab('illustration')} style={activeTab === 'illustration' ? styles.navActive : styles.navBtn}>🎨 绘本插画</button>
          </nav>
        </div>
        
        <div style={{ marginTop: 'auto' }}>
          {!isPro && (
            <div style={styles.upgradeBox}>
              <h4 style={styles.upgradeTitle}>NAL“童心”征文大赛</h4>
              <p style={styles.upgradeDesc}>解锁高级视角的深度协同分析报告。</p>
              
              {!isContestant ? (
                <button onClick={() => handlePayment('contestant')} disabled={payLoading} style={{...styles.payBtn, opacity: payLoading && loadingPlan === 'contestant' ? 0.7 : 1}}>
                  {payLoading && loadingPlan === 'contestant' ? "连接网关..." : "🚀 立即报名 (￥10)"}
                </button>
              ) : (
                <div style={{color: '#10b981', fontSize: '12px', marginBottom: '10px', textAlign: 'center', fontWeight: 'bold'}}>✅ 已获参赛资格</div>
              )}

              <button onClick={() => handlePayment('addon')} disabled={payLoading} style={{...styles.addonBtn, opacity: payLoading && loadingPlan === 'addon' ? 0.7 : 1}}>
                {payLoading && loadingPlan === 'addon' ? "连接网关..." : "🔋 购买加油包 (￥20)"}
              </button>

              <button onClick={() => handlePayment('pro')} disabled={payLoading} style={{...styles.proBtn, opacity: payLoading && loadingPlan === 'pro' ? 0.7 : 1}}>
                {payLoading && loadingPlan === 'pro' ? "连接网关..." : "✨ 升级专业会员 (¥300/年)"}
              </button>
            </div>
          )}

          <div style={styles.userSection}>
            {/* 🚨 修复：身份与参赛状态分离显示，专业版极其醒目 */}
            {isPro ? (
              <div style={styles.proBadge}>✨ NAL 专业会员</div>
            ) : (
              <div style={styles.freeBadge}>☕ 普通用户</div>
            )}

            <div style={isContestant ? styles.contestBadge : styles.pendingBadge}>
               {isContestant ? "🏆 已报名 · 童心大赛" : "📝 未报名 · 童心大赛"}
            </div>

            {/* 🚨 修复：登录账号显示更清晰 */}
            <div style={styles.roleLabel}>
                <span style={{opacity: 0.6}}>账号：</span>{session.user.email}
            </div>
            
            {/* 🚨 修复：退出登录按钮加固显示 */}
            <button onClick={() => supabase.auth.signOut()} style={styles.logoutBtn}>
                退出登录
            </button>
          </div>
        </div>
      </aside>

      <main style={styles.main}>
        <div style={styles.header}>
          <div style={styles.selectorGroup}>
            {activeTab === 'illustration' ? (
              <>
                <label style={styles.label}>评审模式：</label>
                <select value={imageType} onChange={(e) => setImageType(e.target.value)} style={styles.select}>
                  <option value="picture-book">📘 绘本分镜分析</option>
                  <option value="illustration">🖼️ 单幅插画审美</option>
                </select>
              </>
            ) : (
              <>
                <label style={styles.label}>评审专家：</label>
                <select value={selectedModelId} onChange={(e) => setSelectedModelId(e.target.value)} style={styles.select}>
                  {models.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                </select>
              </>
            )}
          </div>

          <div style={styles.statusRow}>
             <div style={styles.statusItem}>
                <span style={styles.statusLabel}>引擎</span>
                <span style={styles.statusValue}>{engine.name}</span>
             </div>
             {!isPro && (
               <div style={styles.statusItem}>
                  <span style={styles.statusLabel}>Flash 剩余</span>
                  <span style={usage.flash > 0 ? styles.statusValue : styles.statusEmpty}>{usage.flash}</span>
               </div>
             )}
             {isContestant && usage[`${activeTab}_pro`] > 0 && (
               <div style={styles.statusItem}>
                  <span style={styles.statusLabel}>高级奖励额度</span>
                  <span style={{...styles.statusValue, color: '#8b5cf6'}}>{usage[`${activeTab}_pro`]}</span>
               </div>
             )}
          </div>
        </div>

        <div style={styles.content}>
          {activeTab === 'illustration' && (
            <div style={styles.uploadArea}>
              <input type="file" id="up" hidden multiple onChange={handleImageChange} accept="image/*" />
              <label htmlFor="up" style={styles.uploadBtn}>
                {selectedImages.length > 0 ? `✅ 已加载 ${selectedImages.length} 张图` : "➕ 点击批量上传评审素材"}
              </label>
              <div style={{fontSize: '11px', color: '#9ca3af', marginTop: '8px'}}>
                {getImageLimitDesc()}
              </div>
            </div>
          )}

          {activeTab === 'text' && (
            <div style={styles.uploadArea}>
              <input type="file" id="docx-up" hidden accept=".docx" onChange={handleDocxChange} />
              <label htmlFor="docx-up" style={styles.uploadBtn}>
                {selectedDocx ? `✅ 已选择文件: ${selectedDocx.name}` : "📄 点击上传 Word 评审文档 (.docx)"}
              </label>
              <div style={{fontSize: '11px', color: '#9ca3af', marginTop: '8px'}}>
                {getUploadLimitDesc()}
              </div>
            </div>
          )}
          
          <textarea 
            style={styles.textarea}
            placeholder={activeTab === 'illustration' ? "请输入分镜文案或创作意图..." : (activeTab === 'guide' ? "请输入您的创作构思大纲..." : "在此输入文本或评审备注...")}
            value={workText}
            onChange={(e) => setWorkText(e.target.value)}
          />

          <button onClick={triggerEvaluation} disabled={loading} style={styles.submitBtn}>
            {loading ? "AI 深度计算中..." : (activeTab === 'guide' ? "启动指导" : "启动评审")}
          </button>
        </div>

        {report && (
          <div style={styles.reportBox}>
            <h3 style={{marginTop: 0, fontSize: '18px', borderBottom: '1px solid #eee', paddingBottom: '10px'}}>🏛️ NAL 专家分析结果</h3>
            <div style={styles.reportTxt}>{report}</div>
          </div>
        )}
      </main>
    </div>
  );
}

const styles = {
  dashboard: { display: 'flex', height: '100vh', backgroundColor: '#f3f4f6', fontFamily: 'system-ui' },
  sidebar: { width: '240px', backgroundColor: '#111827', color: 'white', padding: '30px 20px', display: 'flex', flexDirection: 'column' },
  logo: { fontSize: '20px', fontWeight: 'bold', color: '#a78bfa', marginBottom: '40px' },
  nav: { flex: 1, display: 'flex', flexDirection: 'column', gap: '8px' },
  navBtn: { padding: '12px', textAlign: 'left', background: 'none', border: 'none', color: '#9ca3af', cursor: 'pointer', borderRadius: '8px' },
  navActive: { padding: '12px', textAlign: 'left', background: '#374151', border: 'none', color: 'white', cursor: 'pointer', borderRadius: '8px', fontWeight: 'bold' },
  userSection: { borderTop: '1px solid #374151', paddingTop: '20px' },
  // 🚨 样式优化：专业版徽章
  proBadge: { background: 'linear-gradient(135deg, #8b5cf6 0%, #3b82f6 100%)', color: 'white', fontSize: '13px', padding: '10px', borderRadius: '8px', textAlign: 'center', marginBottom: '10px', fontWeight: 'bold', boxShadow: '0 4px 12px rgba(139, 92, 246, 0.4)' },
  freeBadge: { backgroundColor: '#374151', color: '#e5e7eb', fontSize: '12px', padding: '8px', borderRadius: '6px', textAlign: 'center', marginBottom: '10px', fontWeight: 'bold' },
  contestBadge: { backgroundColor: '#1e3a8a', color: '#60a5fa', fontSize: '11px', padding: '8px', borderRadius: '6px', textAlign: 'center', marginBottom: '12px', fontWeight: 'bold', border: '1px solid #2563eb' },
  pendingBadge: { backgroundColor: 'rgba(255,255,255,0.05)', color: '#9ca3af', fontSize: '11px', padding: '8px', borderRadius: '6px', textAlign: 'center', marginBottom: '12px', border: '1px dashed #4b5563' },
  // 🚨 样式优化：账号显示
  roleLabel: { fontSize: '12px', color: '#9ca3af', textAlign: 'center', marginBottom: '18px', wordBreak: 'break-all', padding: '4px', backgroundColor: 'rgba(255,255,255,0.03)', borderRadius: '4px' },
  // 🚨 样式优化：退出登录
  logoutBtn: { width: '100%', background: '#374151', border: 'none', color: '#f3f4f6', padding: '10px', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold', transition: 'background 0.2s' },
  
  main: { flex: 1, padding: '40px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '20px' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', backgroundColor: 'white', padding: '15px 30px', borderRadius: '12px', boxShadow: '0 1px 2px rgba(0,0,0,0.05)' },
  selectorGroup: { display: 'flex', alignItems: 'center', gap: '10px' },
  select: { padding: '8px', borderRadius: '6px', border: '1px solid #d1d5db', outline: 'none' },
  label: { fontSize: '14px', color: '#6b7280' },
  statusRow: { display: 'flex', gap: '30px' },
  statusItem: { display: 'flex', flexDirection: 'column', alignItems: 'flex-end' },
  statusLabel: { fontSize: '10px', color: '#9ca3af', textTransform: 'uppercase' },
  statusValue: { fontSize: '14px', fontWeight: 'bold', color: '#111827' },
  statusEmpty: { fontSize: '14px', fontWeight: 'bold', color: '#ef4444' },
  content: { display: 'flex', flexDirection: 'column', gap: '15px' },
  textarea: { height: '320px', padding: '20px', borderRadius: '12px', border: '1px solid #d1d5db', fontSize: '16px', lineHeight: '1.7', outline: 'none' },
  uploadArea: { padding: '25px', border: '2px dashed #d1d5db', borderRadius: '12px', textAlign: 'center', backgroundColor: 'white' },
  uploadBtn: { cursor: 'pointer', color: '#6366f1', fontWeight: 'bold' },
  submitBtn: { padding: '16px', backgroundColor: '#111827', color: 'white', border: 'none', borderRadius: '12px', fontWeight: 'bold', cursor: 'pointer' },
  reportBox: { padding: '40px', backgroundColor: 'white', borderRadius: '12px', border: '1px solid #e5e7eb', textAlign: 'left' },
  reportTxt: { whiteSpace: 'pre-wrap', lineHeight: '2.0', color: '#374151', fontSize: '16px' },
  upgradeBox: { backgroundColor: '#1f2937', padding: '16px', borderRadius: '12px', marginBottom: '20px', border: '1px solid #374151' },
  upgradeTitle: { color: '#f9fafb', fontSize: '14px', fontWeight: 'bold', marginTop: '0', marginBottom: '6px' },
  upgradeDesc: { color: '#9ca3af', fontSize: '12px', lineHeight: '1.5', marginBottom: '15px', marginTop: '0'  },
  payBtn: { width: '100%', backgroundColor: '#6366f1', color: 'white', border: 'none', padding: '10px', borderRadius: '8px', fontSize: '13px', fontWeight: 'bold', cursor: 'pointer', marginBottom: '8px', transition: 'background 0.2s' },
  addonBtn: { width: '100%', backgroundColor: '#10b981', color: 'white', border: 'none', padding: '10px', borderRadius: '8px', fontSize: '13px', fontWeight: 'bold', cursor: 'pointer', marginBottom: '8px', transition: 'background 0.2s' },
  proBtn: { width: '100%', backgroundColor: 'transparent', color: '#a78bfa', border: '1px solid #a78bfa',  padding: '8px', borderRadius: '8px', fontSize: '12px', fontWeight: 'bold', cursor: 'pointer' },
};