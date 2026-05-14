import React, { useState, useEffect } from 'react';

import { supabase } from './supabaseClient';

import { usePayment } from './hooks/usePayment';

import { useEvaluation } from './hooks/useEvaluation';



export default function Dashboard({ session }) {

  // --- 1. 核心状态管理 ---

  const [activeTab, setActiveTab] = useState('text'); 

  const [workText, setWorkText] = useState('');

  const [selectedImages, setSelectedImages] = useState([]);

  const [selectedDocx, setSelectedDocx] = useState(null); 



  // 参赛作品专属状态

  const [contestText, setContestText] = useState('');

  const [contestImages, setContestImages] = useState([]);

  const [isSubmitting, setIsSubmitting] = useState(false);



  // 专家模型与引擎配置

  const [models, setModels] = useState([]);

  const [selectedModelId, setSelectedModelId] = useState('');

  const [imageType, setImageType] = useState('illustration'); 



  // 🚨 用户身份与权限逻辑 (包含前端时间拦截器预判到期)

  const [rawUserMetadata, setRawUserMetadata] = useState(session.user.user_metadata || {});

  

  // 复制一份进行安全校验

  let userMetadata = { ...rawUserMetadata };

  if (userMetadata.role === 'pro' && userMetadata.expiry_date) {

    const now = new Date();

    const expiry = new Date(userMetadata.expiry_date);

    if (now > expiry) {

      console.log("前端检测到 Pro 已过期，执行视觉降级");

      userMetadata.role = null; 

      userMetadata.is_paid = false;

    }

  }



  const userRole = userMetadata.role || (userMetadata.is_paid ? 'contestant' : 'free');

  const isPro = userRole === 'pro';

  const isContestant = userRole === 'contestant';

  

  // 核心业务：Pro 用户或已报名用户均可进入参赛通道

  const isEligibleForContest = isContestant || isPro;



  // 算力额度管理

  const [usage, setUsage] = useState({ flash: 0, pro_credits: 0 });



  // 引入支付与评审逻辑 Hooks

  const { payLoading, loadingPlan, handlePayment, setPayLoading } = usePayment();

  const { loading, report, evaluate } = useEvaluation(userRole, usage);



  // --- 2. 初始化与监听逻辑 ---

  const refreshUserMetadata = async () => {

    const { data: { user } } = await supabase.auth.getUser();

    if (user) {

      const meta = user.user_metadata || {};

      setRawUserMetadata(meta);

      setUsage({

        flash: meta.flash_left !== undefined ? meta.flash_left : 5,

        pro_credits: meta.pro_credits || 0  // 统一使用共享池额度

      });

    }

  };



  useEffect(() => {

    refreshUserMetadata();

    

    // A. 处理从首页/认证页传来的支付意图 

    const params = new URLSearchParams(window.location.search);

    const intent = params.get('intent');

    if (intent === 'pro' && !isPro) {

      handlePayment('pro');

    } else if (intent === 'contestant' && !isContestant && !isPro) {

      handlePayment('contestant');

    }



    // B. 获取专家模型列表，锁定“首席专家”

    const fetchModels = async () => {

      const { data } = await supabase.from('evaluation_models').select('id, name');

      if (data) {

        let filtered = isPro ? data : data.filter(m => m.name.includes('全景综合') || m.name.includes('首席专家'));

        setModels(filtered);

        const defaultModel = filtered.find(m => m.name.includes('首席专家'));

        if (defaultModel) setSelectedModelId(defaultModel.id);

        else if (filtered.length > 0) setSelectedModelId(filtered[0].id);

      }

    };

    fetchModels();



    // C. 路径清理：防止刷新重复触发支付

    if (params.get('session_id') || params.get('intent')) {

      setTimeout(() => {

        window.history.replaceState({}, document.title, window.location.pathname);

      }, 500);

    }

  }, [userRole, isPro]);



  // --- 3. 业务处理函数 ---



  // 处理常规评审图片上传

  const handleImageChange = (e) => {

    const files = Array.from(e.target.files);

    const max = isPro ? 50 : (isContestant ? 5 : 2);

    if (files.length > max) {

      return alert(`数量超限！您当前身份最多只能上传 ${max} 张图片。`);

    }

    setSelectedImages(files);

  };



  // 处理常规 Word 上传

  const handleDocxChange = (e) => {

    if (e.target.files.length > 0) setSelectedDocx(e.target.files[0]); 

  };



  // 触发 AI 评审

  const triggerEvaluation = async () => {

    const success = await evaluate({

      activeTab, workText, selectedImages, selectedDocx, imageType, selectedModelId

    });

    if (success) {

      setWorkText(''); 

      setTimeout(refreshUserMetadata, 1500); 

    }

  };



  // 提交大赛作品逻辑

  const submitContestWork = async () => {

    if (contestImages.length < 1 || contestImages.length > 2) {

      return alert("报名失败：请务必上传 1 到 2 幅与文字相关的插画！");

    }

    if (contestText.trim().length < 100) { 

      return alert("报名失败：参赛文字内容字数不足（建议约 800 字）。");

    }



    setIsSubmitting(true);

    try {

      const imageUrls = [];

      for (const file of contestImages) {

        const fileExt = file.name.split('.').pop();

        const fileName = `${session.user.id}_${Date.now()}_${Math.random().toString(36).substring(7)}.${fileExt}`;

        const { error: uploadError } = await supabase.storage.from('contest_works').upload(fileName, file);

        if (uploadError) throw uploadError;

        const { data } = supabase.storage.from('contest_works').getPublicUrl(fileName);

        imageUrls.push(data.publicUrl);

      }



      const { error: dbError } = await supabase.from('contest_submissions').insert({

        user_id: session.user.id,

        user_email: session.user.email,

        text_content: contestText,

        image_urls: imageUrls

      });

      if (dbError) throw dbError;



      alert("🎉 参赛作品提交成功！官方组委会已收到您的心血之作。");

      setContestText('');

      setContestImages([]);

      setActiveTab('text'); 

    } catch (error) {

      alert("❌ 提交失败: " + error.message);

    } finally {

      setIsSubmitting(false);

    }

  };



  // --- 4. 辅助文案渲染 ---

  const engineName = isPro ? "文学专业旗舰版" : (isContestant ? "高级文学引擎" : "基础版");

  

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

      {/* 🚨 积木：支付处理中遮罩层 */}

      {payLoading && (

        <div style={styles.overlay}>

          <div style={styles.paymentModal}>

            <div style={styles.spinner}></div>

            <h3 style={{ margin: '20px 0 10px 0', color: '#111827' }}>正在为您连接安全支付网关...</h3>

            <p style={{ color: '#6b7280', fontSize: '14px', marginBottom: '20px' }}>

              即将解锁：{loadingPlan === 'pro' ? '文学专业旗舰算力' : '大赛官方参赛资格'}

            </p>

            <button 

              onClick={() => {

                if(setPayLoading) setPayLoading(false);

                window.history.replaceState({}, document.title, window.location.pathname);

              }} 

              style={styles.cancelPayBtn}

            >

              取消并返回工作台

            </button>

          </div>

        </div>

      )}



      {/* 侧边栏 */}

      <aside style={styles.sidebar}>

        <div>

          <h2 style={styles.logo}>NAL Collective</h2>

          <nav style={styles.nav}>

            <button onClick={() => setActiveTab('guide')} style={activeTab === 'guide' ? styles.navActive : styles.navBtn}>💡 创作指导</button>

            <button onClick={() => setActiveTab('text')} style={activeTab === 'text' ? styles.navActive : styles.navBtn}>📝 文字评审</button>

            <button onClick={() => setActiveTab('illustration')} style={activeTab === 'illustration' ? styles.navActive : styles.navBtn}>🎨 绘本插画</button>

            

            {/* 参赛通道 */}

            {isEligibleForContest && (

              <button 

                onClick={() => setActiveTab('contest')} 

                style={activeTab === 'contest' ? {...styles.navActive, backgroundColor: '#4f46e5'} : {...styles.navBtn, color: '#818cf8'}}

              >

                🏆 提交参赛作品

              </button>

            )}

          </nav>

        </div>

        

        <div style={{ marginTop: 'auto' }}>

          {!isPro && (

            <div style={styles.upgradeBox}>

              <h4 style={styles.upgradeTitle}>NAL“童心”征文大赛</h4>

              {!isContestant ? (

                <button onClick={() => handlePayment('contestant')} disabled={payLoading} style={styles.payBtn}>

                   🚀 立即报名 (￥10)

                </button>

              ) : (

                <div style={{color: '#10b981', fontSize: '12px', marginBottom: '10px', textAlign: 'center', fontWeight: 'bold'}}>✅ 已获参赛资格</div>

              )}

              <button onClick={() => handlePayment('addon')} disabled={payLoading} style={styles.addonBtn}>

                 🔋 购买加油包 (￥20)

              </button>

              {/* 🚨 价格改为 500元 */}

              <button onClick={() => handlePayment('pro')} disabled={payLoading} style={styles.proBtn}>

                 ✨ 升级专业会员 (¥500/年)

              </button>

            </div>

          )}



          <div style={styles.userSection}>

            {isPro ? (

              <>

                <div style={styles.proBadge}>✨ NAL 专业会员</div>

                {/* 🚨 显示过期时间 */}

                {userMetadata.expiry_date && (

                  <div style={{fontSize: '11px', color: '#9ca3af', textAlign: 'center', marginBottom: '10px'}}>

                    有效期至：{new Date(userMetadata.expiry_date).toLocaleDateString()}

                  </div>

                )}

              </>

            ) : (

              <div style={styles.freeBadge}>☕ 普通用户</div>

            )}

            

            <div style={isEligibleForContest ? styles.contestBadge : styles.pendingBadge}>

               {isEligibleForContest ? "🏆 已获参赛资格" : "📝 未报名 · 童心大赛"}

            </div>

            <div style={styles.roleLabel}><span style={{opacity: 0.6}}>账号：</span>{session.user.email}</div>

            <button onClick={() => supabase.auth.signOut()} style={styles.logoutBtn}>退出登录</button>

          </div>

        </div>

      </aside>



      {/* 主面板 */}

      <main style={styles.main}>

        {/* 顶部状态栏 */}

        {activeTab !== 'contest' && (

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

                  <span style={styles.statusValue}>{engineName}</span>

               </div>

               

               {/* 🚨 1. 显示基础 Flash 额度 (Pro 显示无限) */}

               {!isPro && (

                 <div style={styles.statusItem}>

                    <span style={styles.statusLabel}>Flash 剩余</span>

                    <span style={usage.flash > 0 ? styles.statusValue : styles.statusEmpty}>

                      {usage.flash >= 9999 ? "无限" : usage.flash}

                    </span>

                 </div>

               )}

               

               {/* 🚨 2. 显示通用高级 Pro 额度 (Pro 显示无限) */}

               {(usage.pro_credits > 0 || isPro) && (

                 <div style={styles.statusItem}>

                    <span style={styles.statusLabel}>高级 Pro 额度</span>

                    <span style={{...styles.statusValue, color: '#10b981'}}>

                      {isPro ? "无限" : usage.pro_credits}

                    </span>

                 </div>

               )}



               {/* 🚨 3. 显示每日熔断 3.1 剩余次数 (仅限 Pro) */}

               {isPro && (

                 <div style={styles.statusItem}>

                    <span style={styles.statusLabel}>今日 3.1 剩余</span>

                    <span style={{...styles.statusValue, color: '#8b5cf6'}}>

                      {Math.max(0, 5 - (userMetadata.pro_daily_used || 0))} / 5

                    </span>

                 </div>

               )}

            </div>

          </div>

        )}



        <div style={styles.content}>

          {/* A. 参赛作品提交界面 */}

          {activeTab === 'contest' ? (

            <div style={styles.reportBox}>

              <h3 style={{ marginTop: 0, color: '#111827', borderBottom: '2px solid #f3f4f6', paddingBottom: '15px' }}>

                🌟 NAL“童心”征文大赛 - 官方通道

              </h3>

              <div style={styles.uploadArea}>

                <input type="file" id="c-img" hidden multiple accept="image/*" onChange={(e) => setContestImages(Array.from(e.target.files).slice(0,2))} />

                <label htmlFor="c-img" style={styles.uploadBtn}>

                  {contestImages.length > 0 ? `✅ 已选择 ${contestImages.length} 幅插画` : "🖼️ 上传相关插画 (1-2幅)"}

                </label>

              </div>

              <textarea 

                style={{...styles.textarea, height: '400px', marginTop: '20px', backgroundColor: '#f9fafb'}}

                placeholder="在此粘贴您的参赛原创文字作品（要求：约 800 字）..."

                value={contestText}

                onChange={(e) => setContestText(e.target.value)}

              />

              <div style={{ textAlign: 'right', marginTop: '10px', color: contestText.length > 300 ? '#10b981' : '#ef4444', fontWeight: 'bold' }}>

                当前统计：{contestText.length} 字

              </div>

              <button onClick={submitContestWork} disabled={isSubmitting} style={{...styles.submitBtn, width: '100%', marginTop: '20px', backgroundColor: '#4f46e5'}}>

                {isSubmitting ? "作品上传加密中..." : "📤 确认提交参赛作品"}

              </button>

            </div>

          ) : (

            /* B. 常规 AI 评审界面 */

            <>

              {activeTab === 'illustration' && (

                <div style={styles.uploadArea}>

                  <input type="file" id="up" hidden multiple onChange={handleImageChange} accept="image/*" />

                  <label htmlFor="up" style={styles.uploadBtn}>

                    {selectedImages.length > 0 ? `✅ 已加载 ${selectedImages.length} 张图` : "➕ 点击批量上传评审素材"}

                  </label>

                  <div style={{fontSize: '11px', color: '#9ca3af', marginTop: '8px'}}>{getImageLimitDesc()}</div>

                </div>

              )}

              {activeTab === 'text' && (

                <div style={styles.uploadArea}>

                  <input type="file" id="docx-up" hidden accept=".docx" onChange={handleDocxChange} />

                  <label htmlFor="docx-up" style={styles.uploadBtn}>

                    {selectedDocx ? `✅ 已选择: ${selectedDocx.name}` : "📄 上传 Word 评审文档 (.docx)"}

                  </label>

                  <div style={{fontSize: '11px', color: '#9ca3af', marginTop: '8px'}}>{getUploadLimitDesc()}</div>

                </div>

              )}

              <textarea 

                style={styles.textarea}

                placeholder={activeTab === 'guide' ? "输入您的创作大纲..." : "粘贴文本或评审备注..."}

                value={workText}

                onChange={(e) => setWorkText(e.target.value)}

              />

              <button onClick={triggerEvaluation} disabled={loading} style={styles.submitBtn}>

                {loading ? "AI 深度计算中..." : (activeTab === 'guide' ? "启动指导" : "启动评审")}

              </button>

            </>

          )}

        </div>



        {/* 评审报告展示区 */}

        {report && activeTab !== 'contest' && (

          <div style={styles.reportBox}>

            <h3 style={{marginTop: 0, fontSize: '18px', borderBottom: '1px solid #eee', paddingBottom: '10px'}}>🏛️ NAL 专家分析结果</h3>

            <div style={styles.reportTxt}>{report}</div>

          </div>

        )}

      </main>

    </div>

  );

}



// === 完整 CSS 样式表 ===

const styles = {

  dashboard: { display: 'flex', height: '100vh', backgroundColor: '#f3f4f6', fontFamily: 'system-ui' },

  overlay: { position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.6)', display: 'flex', zIndex: 1000 },

  paymentModal: { margin: 'auto', backgroundColor: 'white', padding: '40px', borderRadius: '24px', textAlign: 'center', width: '90%', maxWidth: '400px', boxShadow: '0 20px 50px rgba(0,0,0,0.2)' },

  spinner: { width: '40px', height: '40px', border: '4px solid #f3f4f6', borderTop: '4px solid #4f46e5', borderRadius: '50%', margin: '0 auto', animation: 'spin 1s linear infinite' },

  cancelPayBtn: { background: 'none', border: '1px solid #d1d5db', color: '#6b7280', padding: '10px 20px', borderRadius: '10px', cursor: 'pointer', fontSize: '14px', fontWeight: 'bold' },

  sidebar: { width: '240px', backgroundColor: '#111827', color: 'white', padding: '30px 20px', display: 'flex', flexDirection: 'column' },

  logo: { fontSize: '20px', fontWeight: 'bold', color: '#a78bfa', marginBottom: '40px' },

  nav: { flex: 1, display: 'flex', flexDirection: 'column', gap: '8px' },

  navBtn: { padding: '12px', textAlign: 'left', background: 'none', border: 'none', color: '#9ca3af', cursor: 'pointer', borderRadius: '8px' },

  navActive: { padding: '12px', textAlign: 'left', background: '#374151', border: 'none', color: 'white', cursor: 'pointer', borderRadius: '8px', fontWeight: 'bold' },

  userSection: { borderTop: '1px solid #374151', paddingTop: '20px' },

  proBadge: { background: 'linear-gradient(135deg, #8b5cf6 0%, #3b82f6 100%)', color: 'white', fontSize: '13px', padding: '10px', borderRadius: '8px', textAlign: 'center', marginBottom: '10px', fontWeight: 'bold', boxShadow: '0 4px 12px rgba(139, 92, 246, 0.4)' },

  freeBadge: { backgroundColor: '#374151', color: '#e5e7eb', fontSize: '12px', padding: '8px', borderRadius: '6px', textAlign: 'center', marginBottom: '10px', fontWeight: 'bold' },

  contestBadge: { backgroundColor: '#1e3a8a', color: '#60a5fa', fontSize: '11px', padding: '8px', borderRadius: '6px', textAlign: 'center', marginBottom: '12px', fontWeight: 'bold', border: '1px solid #2563eb' },

  pendingBadge: { backgroundColor: 'rgba(255,255,255,0.05)', color: '#9ca3af', fontSize: '11px', padding: '8px', borderRadius: '6px', textAlign: 'center', marginBottom: '12px', border: '1px dashed #4b5563' },

  roleLabel: { fontSize: '12px', color: '#9ca3af', textAlign: 'center', marginBottom: '18px', wordBreak: 'break-all', padding: '4px', backgroundColor: 'rgba(255,255,255,0.03)', borderRadius: '4px' },

  logoutBtn: { width: '100%', background: '#374151', border: 'none', color: '#f3f4f6', padding: '10px', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold' },

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

  upgradeTitle: { color: '#f9fafb', fontSize: '14px', fontWeight: 'bold', marginTop: '0', marginBottom: '8px' },

  payBtn: { width: '100%', backgroundColor: '#6366f1', color: 'white', border: 'none', padding: '10px', borderRadius: '8px', fontSize: '13px', fontWeight: 'bold', cursor: 'pointer', marginBottom: '8px' },

  addonBtn: { width: '100%', backgroundColor: '#10b981', color: 'white', border: 'none', padding: '10px', borderRadius: '8px', fontSize: '13px', fontWeight: 'bold', cursor: 'pointer', marginBottom: '8px' },

  proBtn: { width: '100%', backgroundColor: 'transparent', color: '#a78bfa', border: '1px solid #a78bfa', padding: '8px', borderRadius: '8px', fontSize: '12px', fontWeight: 'bold', cursor: 'pointer' },

};
