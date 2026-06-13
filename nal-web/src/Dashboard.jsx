import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom'; 
import { supabase } from './supabaseClient';
import { usePayment } from './hooks/usePayment';
import { useEvaluation } from './hooks/useEvaluation';
import logo from './assets/nal_logo.png';

export default function Dashboard({ session }) {
  const navigate = useNavigate();

  // --- 1. 核心状态管理 ---
  const [activeTab, setActiveTab] = useState('text'); 
  const [workText, setWorkText] = useState('');
  const [selectedImages, setSelectedImages] = useState([]);
  const [selectedDocx, setSelectedDocx] = useState(null); 
  
  // 动态多赛季全局中控状态
  const [isContestActive, setIsContestActive] = useState(false);
  const [activeContestId, setActiveContestId] = useState(''); 
  const [contestName, setContestName] = useState('');
  const [contestDescription, setContestDescription] = useState('');
  const [submissionDeadline, setSubmissionDeadline] = useState(null); 

  const [imageTexts, setImageTexts] = useState([]); 

  // 参赛作品专属状态
  const [contestText, setContestText] = useState('');
  const [contestImages, setContestImages] = useState([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  
  // 评审进度相关
  const [userSubmissions, setUserSubmissions] = useState([]); 
  const [isRefreshing, setIsRefreshing] = useState(false); 

  // 专家模型与引擎配置状态
  const [models, setModels] = useState([]);
  const [selectedModelId, setSelectedModelId] = useState('');
  const [imageType, setImageType] = useState('picturebook'); 

  // 防止 undefined 穿透
  const initialMeta = session?.user?.user_metadata || {};
  const [rawUserMetadata, setRawUserMetadata] = useState(initialMeta);
  
  const [usage, setUsage] = useState({ 
    flash: initialMeta.flash_left !== undefined ? initialMeta.flash_left : 5, 
    pro_credits: initialMeta.pro_credits || 0
  });

  // 🌟 核心新增：身份确权判定，拦截管理员误入普通用户控制台
  const isAdmin = rawUserMetadata.role === 'admin';

  // 1. 动态判定 Pro 是否过期
  let processedRole = rawUserMetadata.role;
  let isProExpired = false;
  if (processedRole === 'pro' && rawUserMetadata.expiry_date) {
    if (new Date() > new Date(rawUserMetadata.expiry_date)) {
      processedRole = null; 
      isProExpired = true; 
    }
  }

  // 2. 赛事门票动态防线（与当前激活的主赛场 ID 强绑定）
  const isCurrentContestant = rawUserMetadata.role === 'contestant' && 
                              rawUserMetadata.paid_contest_id === activeContestId;

  const userRole = isProExpired ? 'free' : (processedRole || (isCurrentContestant ? 'contestant' : 'free'));
  const isPro = userRole === 'pro';
  const isContestant = userRole === 'contestant';

  // 3. 额度动态洗白
  const displayUsage = {
    flash: (isProExpired && usage.flash >= 9999) ? 5 : Math.max(0, Number(usage.flash || 0)),
    pro_credits: (isProExpired && usage.pro_credits >= 9999) ? 0 : Math.max(0, Number(usage.pro_credits || 0))
  };

  const hasAddon = !isProExpired && (displayUsage.pro_credits > 0);
  const isEligibleForContest = isContestant || isPro;

  const maxImageCount = (() => {
    if (imageType === 'illustration') return isPro ? 10 : (isContestant || hasAddon ? 5 : 2);
    return isPro ? 50 : (isContestant || hasAddon ? 5 : 2); 
  })();

  const currentLimits = (() => {
     if (isPro) return { count: maxImageCount, bytes: 100 * 1024 * 1024, mb: 5, display: '100MB' };
     if (isContestant || hasAddon) return { count: maxImageCount, bytes: 150 * 1024, mb: 1.5, display: '150KB' };
     return { count: maxImageCount, bytes: 50 * 1024, mb: 1, display: '50KB' };
  })();

  const maxDocxSize = currentLimits.bytes;
  const maxImageSizeMB = currentLimits.mb;
  const maxDocSizeDisplay = currentLimits.display;

  const { payLoading, handlePayment, setPayLoading } = usePayment();
  const { loading, report, evaluate } = useEvaluation(userRole, usage); 

  // --- 2. 初始化与监听逻辑 ---

  const fetchUserSubmissions = useCallback(async () => {
    // 如果是管理员或者没有基本账号信息，直接退回，防止空转引发数据库开销
    if (!session?.user?.id || isAdmin) return;
    setIsRefreshing(true);
    
    const { data } = await supabase
      .from('contest_submissions')
      .select('id, status, created_at, ai_total_score, error_msg, exhibition_ready, is_manual_recommended, contest_id') 
      .eq('user_id', session.user.id)
      .eq('contest_id', activeContestId) 
      .order('created_at', { ascending: false });
    
    if (data) setUserSubmissions(data);
    setTimeout(() => setIsRefreshing(false), 500); 
  }, [session?.user?.id, activeContestId, isAdmin]);

  const refreshUserMetadata = async () => {
    if (isAdmin) return; // 管理员无需刷新用户消费资源算力
    const { data: { session: currentSession } } = await supabase.auth.refreshSession();
    const user = currentSession?.user || session?.user;
    if (user) {
      let meta = user.user_metadata || {};
      if (meta.flash_left === undefined) {
        const { data, error } = await supabase.auth.updateUser({ data: { flash_left: 5 } });
        if (!error && data?.user) meta = data.user.user_metadata;
      }
      setRawUserMetadata(meta);
      setUsage({
        flash: meta.flash_left !== undefined ? meta.flash_left : 5,
        pro_credits: meta.pro_credits || 0
      });
    }
  };

  const fetchSiteSettings = async () => {
    try {
      const { data: settings } = await supabase.from('site_settings').select('*').eq('id', 1).maybeSingle();
      if (settings) {
        setIsContestActive(settings.is_contest_active);
        if (settings.current_contest_id) {
          setActiveContestId(settings.current_contest_id); 
          const { data: contestData } = await supabase.from('contests').select('*').eq('id', settings.current_contest_id).maybeSingle();
          if (contestData) {
            setContestName(contestData.name);
            setContestDescription(contestData.description);
            setSubmissionDeadline(contestData.submission_deadline); 
          }
        }
        if (activeTab === 'text' && settings.is_contest_active) setActiveTab('dynamics');
      }
    } catch (err) {
      console.error("⚠️ 读取全局配置失败:", err);
    }
  };
  
  useEffect(() => {
    fetchSiteSettings();
    if (!isAdmin) {
      refreshUserMetadata();
    }
    
    const fetchModels = async () => {
      const { data } = await supabase.from('evaluation_models').select('id, name, description');
      if (data) {
        let filtered = isPro ? data : data.filter(m => m.name.includes('全景综合') || m.name.includes('首席专家'));
        setModels(filtered);
        const defaultModel = filtered.find(m => m.name.includes('首席专家'));
        if (defaultModel) setSelectedModelId(defaultModel.id);
        else if (filtered.length > 0) setSelectedModelId(filtered[0].id);
      }
    };
    fetchModels();
  }, [userRole, isPro, isAdmin]);

  useEffect(() => {
    if (activeContestId && session?.user?.id && !isAdmin) {
      fetchUserSubmissions();
      const submissionSubscription = supabase
        .channel('contest_changes')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'contest_submissions', filter: `user_id=eq.${session.user.id}` }, () => fetchUserSubmissions())
        .subscribe();
      return () => supabase.removeChannel(submissionSubscription);
    }
  }, [activeContestId, session?.user?.id, fetchUserSubmissions, isAdmin]);

  // --- 3. 业务处理函数 ---
  const removeContestImage = (index) => setContestImages(prev => prev.filter((_, i) => i !== index));
  const removeSelectedImage = (index) => {
    setSelectedImages(prev => prev.filter((_, i) => i !== index));
    setImageTexts(prev => prev.filter((_, i) => i !== index));
  };
  const handleImageTextChange = (index, text) => {
    const newTexts = [...imageTexts];
    newTexts[index] = text;
    setImageTexts(newTexts);
  };

  const handleImageChange = useCallback((e) => {
    const files = Array.from(e.target.files);
    setSelectedImages(prev => {
      const newList = [...prev, ...files];
      if (newList.length > maxImageCount) {
        alert(`数量超限！当前账户最多允许上传 ${maxImageCount} 张图片。`);
        return prev; 
      }
      const oversizedFiles = files.filter(f => f.size > maxImageSizeMB * 1024 * 1024);
      if (oversizedFiles.length > 0) {
        alert(`文件过大！单张不超过 ${maxImageSizeMB}MB。`);
        return prev;
      }
      setImageTexts(prevTexts => [...prevTexts, ...Array(files.length).fill('')]);
      return newList;
    });
  }, [maxImageCount, maxImageSizeMB]);
  
  const handleDocxChange = useCallback((e) => {
    if (e.target.files.length > 0) {
      const file = e.target.files[0];
      if (file.size > maxDocxSize) return alert(`文件过大！最多上传 ${maxDocSizeDisplay} 的文档。`);
      setSelectedDocx(file);
    }
  }, [maxDocxSize, maxDocSizeDisplay]); 
  
  const handleContestImageUpload = (e) => {
    const files = Array.from(e.target.files);
    const oversizedFiles = files.filter(f => f.size > maxImageSizeMB * 1024 * 1024);
    if (oversizedFiles.length > 0) return alert(`文件过大！单张插画不得超过 ${maxImageSizeMB}MB。`);
    setContestImages(prev => [...prev, ...files].slice(0, 2));
  };

  const triggerEvaluation = async () => {
    const pageTextsJson = isPro ? JSON.stringify(imageTexts) : null;
    const success = await evaluate({
      activeTab, workText, selectedImages, selectedDocx, imageType, selectedModelId, page_texts_json: pageTextsJson
    });
    setTimeout(refreshUserMetadata, 1500);
    if (success) {
      setWorkText(''); 
      setSelectedImages([]);
      setImageTexts([]);
      setSelectedDocx(null);
    }
  };

  const submitContestWork = async () => {
    if (contestImages.length < 1 || contestImages.length > 2) return alert("请上传 1-2 幅插画！");
    if (contestText.trim().length < 500) return alert("参赛文字内容需接近 800 字。");
    
    const hasExisting = userSubmissions.some(s => s.status !== 'invalid');
    if (hasExisting) return alert("您已经提交过参赛作品，每个账户限投一次。");

    setIsSubmitting(true);
    try {
      const imageUrls = [];
      for (const file of contestImages) {
        const fileExt = file.name.split('.').pop();
        const fileName = `${session?.user?.id}_${Date.now()}.${fileExt}`;
        const { error: uploadError } = await supabase.storage.from('contest_works').upload(fileName, file);
        if (uploadError) throw uploadError;
        const { data } = supabase.storage.from('contest_works').getPublicUrl(fileName);
        imageUrls.push(data.publicUrl);
      }

      const targetContestId = activeContestId || '2026_contest';

      const { error: dbError } = await supabase.from('contest_submissions').insert({
        user_id: session?.user?.id,
        user_email: session?.user?.email,
        text_content: contestText,
        image_urls: imageUrls,
        status: 'pending',
        contest_id: targetContestId
      });
      if (dbError) throw dbError;

      alert("🎉 提交成功！您的作品已封存并进入智能评审大阵，请在右侧追踪进度。");
      setContestText('');
      setContestImages([]);
      fetchUserSubmissions(); 
    } catch (error) {
      alert("❌ 失败: " + error.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const renderStatusBadge = (status) => {
    const badges = {
      pending: { label: '⏳ 待校验', color: '#94a3b8' },
      processing: { label: '🧠 评审中', color: '#4f46e5' },
      success: { label: '✅ 评审通过', color: '#10b981' },
      selected: { label: '🎉 评审通过', color: '#10b981' }, 
      rejected: { label: '🥀 遗憾落选', color: '#64748b' }, 
      invalid: { label: '❌ 未通过', color: '#ef4444' }
    };
    const b = badges[status] || { label: status, color: '#374151' };
    return <span style={{ backgroundColor: b.color, color: 'white', padding: '4px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: 'bold' }}>{b.label}</span>;
  };

  // 🌟 核心拦截渲染层：如果判定当前登录者是管理员，在这里执行彻底的“物理熔断”，阻止渲染下方任何工作台组件
  if (isAdmin) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100vh', backgroundColor: '#0a0a0a', color: '#fff', fontFamily: 'monospace', padding: '20px', textAlign: 'center' }}>
        <div style={{ fontSize: '64px', marginBottom: '25px', animation: 'pulse 2s infinite' }}>🚧</div>
        <h2 style={{ color: '#ef4444', fontSize: '24px', fontWeight: 'bold', marginBottom: '15px', letterSpacing: '1px' }}>
          安全拦截：管理员账户禁止访问创作者终端
        </h2>
        <p style={{ color: '#9ca3af', fontSize: '14px', lineHeight: '1.8', maxWidth: '520px', marginBottom: '35px', textAlign: 'justify' }}>
          检测到您当前登录的是 NAL 全局管理账号。为确保分布式评审数据流与赛季总控大闸的绝对隔离，防止发生账户状态交叉污染，管理员身份已被限制在用户工作区之外。请移步至专属的中央调度台。
        </p>
        <div style={{ display: 'flex', gap: '20px' }}>
          <button 
            onClick={() => navigate('/admin')} // 👈 绑定到项目的管理员后台页面路径
            style={{ padding: '14px 30px', backgroundColor: '#4f46e5', color: '#fff', border: 'none', borderRadius: '8px', fontWeight: 'bold', cursor: 'pointer', fontSize: '14px', boxShadow: '0 4px 15px rgba(79, 70, 229, 0.3)' }}
          >
            🏛️ 前往中央管理台
          </button>
          <button 
            onClick={() => { supabase.auth.signOut(); window.location.reload(); }}
            style={{ padding: '14px 30px', backgroundColor: 'transparent', color: '#9ca3af', border: '1px solid #374151', borderRadius: '8px', fontWeight: 'bold', cursor: 'pointer', fontSize: '14px' }}
          >
            安全撤离并退出
          </button>
        </div>
      </div>
    );
  }

  // 以下为普通创作者的正常业务矩阵数据状态
  const alreadySubmitted = userSubmissions.some(s => s.status !== 'invalid');
  const now = new Date();
  const isPastDeadline = submissionDeadline ? now > new Date(submissionDeadline) : false;
  const canSubmitNew = isContestActive && isEligibleForContest && !alreadySubmitted && !isPastDeadline;

  const engineName = isPro ? "文学专业旗舰版" : (isContestant ? "高级文学引擎" : "基础版");

  let isPictureBookValid = true;
  let requiredTextCount = 0;
  let filledTextCount = 0;
  let warningMessage = "";

  if (activeTab === 'picturebook' && selectedImages.length > 0) {
    const count = selectedImages.length;
    if (isPro) {
      filledTextCount = imageTexts.filter(t => t && t.trim().length > 0).length;
      if (imageType === 'picturebook') {
        if (count <= 10) requiredTextCount = Math.ceil(count * 0.8); 
        else if (count <= 30) requiredTextCount = Math.ceil(count * 0.6); 
        else requiredTextCount = Math.max(15, Math.ceil(count * 0.4)); 

        if (filledTextCount < requiredTextCount) {
          isPictureBookValid = false;
          warningMessage = `🚨 绘本专业要求：当前上传 ${count} 跨页，您至少需填写 ${requiredTextCount} 页文本（已填 ${filledTextCount}）。`;
        }
      } else {
        if (filledTextCount < count) {
          isPictureBookValid = false;
          warningMessage = `🚨 插画专业要求：必须为每一幅上传的插画填写理念（已填 ${filledTextCount} / ${count}）。`;
        }
      }
    } else {
      isPictureBookValid = true;
    }
  }

  return (
    <div style={styles.dashboard}>
      {payLoading && (
        <div style={styles.overlay}>
          <div style={styles.paymentModal}>
            <div style={styles.spinner}></div>
            <h3 style={{ margin: '20px 0 10px 0', color: '#111827' }}>正在连接支付网关...</h3>
            <button onClick={() => setPayLoading(false)} style={styles.cancelPayBtn}>返回</button>
          </div>
        </div>
      )}

      <aside style={styles.sidebar}>
        <div>
          <div style={styles.sidebarHeader} onClick={() => window.location.reload()}>
            <img src={logo} alt="NAL Logo" style={styles.sidebarLogoImg} />
            <h2 style={styles.logo}>NAL Collective</h2>
          </div>
          <nav style={styles.nav}>
            {isContestActive && (
              <button onClick={() => setActiveTab('dynamics')} style={activeTab === 'dynamics' ? {...styles.navActive, backgroundColor: '#b45309'} : { ...styles.navBtn, color: '#fbbf24' }}>
                🔥 大赛官方动态
              </button>
            )}
            
            <button onClick={() => setActiveTab('guide')} style={activeTab === 'guide' ? styles.navActive : styles.navBtn}>💡 创作指导</button>
            <button onClick={() => setActiveTab('text')} style={activeTab === 'text' ? styles.navActive : styles.navBtn}>📝 文字评审</button>
            <button onClick={() => setActiveTab('picturebook')} style={activeTab === 'picturebook' ? styles.navActive : styles.navBtn}>🎨 绘本插画</button>
            <button onClick={() => navigate('/gallery')} style={{...styles.navBtn, border: '1px solid #4b5563', marginTop: '10px', color: '#fff'}}>🏛️ 访问文学展厅</button>
            
            {(isContestActive && isEligibleForContest) && (
              <button 
                onClick={() => setActiveTab('contest')} 
                style={activeTab === 'contest' ? { ...styles.navActive, backgroundColor: '#4f46e5', marginTop: '10px' } : { ...styles.navBtn, color: '#818cf8', marginTop: '10px' }}
              >
                🏆 参赛作品与档案
              </button>
            )}
          </nav>
        </div>
        
        <div style={{ marginTop: 'auto' }}>
          <div style={styles.upgradeBox}>
            <h4 style={styles.upgradeTitle}>{isContestActive ? (contestName || "NAL官方征文大赛") : "NAL 专属资源中心"}</h4>
            {isContestActive && (
              (isContestant || isPro) ? (
                <div style={{ color: '#10b981', fontSize: '12px', marginBottom: '10px', textAlign: 'center', fontWeight: 'bold' }}>✅ 已获参赛资格</div>
              ) : (
                <button onClick={() => handlePayment('contestant')} style={styles.payBtn}>🚀 立即报名</button>
              )
            )}
            {(!isPro && usage.flash <= 0 && usage.pro_credits <= 0) && (
              <button onClick={() => handlePayment('addon')} style={styles.addonBtn}>🔋 购买资源加油包</button>
            )}
            {!isPro && (
              <button onClick={() => handlePayment('pro')} style={styles.proBtn}>✨ 升级专业会员</button>
            )}
          </div>
                    
          <div style={styles.userSection}>
            <div style={styles.roleLabel}>{session?.user?.email || '加载中...'}</div>
            <button onClick={() => supabase.auth.signOut()} style={styles.logoutBtn}>退出登录</button>
          </div>
        </div>
      </aside>

      <main style={styles.main}>
        <div style={styles.header}>
          <h2 style={{ margin: '0', fontSize: '20px', color: '#111827', fontWeight: 'bold' }}>
            {activeTab === 'dynamics' && '🔥 大赛官方动态'}
            {activeTab === 'contest' && '🏆 参赛作品与进度'}
            {activeTab === 'guide' && '💡 创作指导'}
            {activeTab === 'text' && '📝 文字评审'}
            {activeTab === 'picturebook' && '🎨 绘本插画'}
          </h2>

          <div style={styles.statusRow}>
             <div style={styles.statusItem}>
               <span style={styles.statusLabel}>当前引擎</span>
               <span style={styles.statusValue}>{engineName}</span>
             </div>
             {isPro ? (
               <div style={styles.statusItem}>
                 <span style={styles.statusLabel}>Pro 额度</span>
                 <span style={styles.statusValue}>无限</span>
               </div>
             ) : (isContestant || hasAddon) ? (
               <>
                 <div style={styles.statusItem}>
                   <span style={styles.statusLabel}>Flash 剩余</span>
                   <span style={styles.statusValue}>{displayUsage.flash}</span>
                 </div>
                <div style={styles.statusItem}>
                   <span style={styles.statusLabel}>Pro 额度剩余</span>
                   <span style={styles.statusValue}>{displayUsage.pro_credits}</span>
                 </div>
               </>
             ) : (
               <div style={styles.statusItem}>
                 <span style={styles.statusLabel}>Flash 剩余</span>
                 <span style={styles.statusValue}>{displayUsage.flash}</span>
               </div>
             )}
          </div>
        </div>

        <div style={styles.content}>
          {activeTab === 'dynamics' ? (
            <div style={{ padding: '40px', borderRadius: '16px', background: 'linear-gradient(145deg, #111827 0%, #1f2937 100%)', border: '1px solid #374151', color: '#f3f4f6', boxShadow: '0 10px 30px rgba(0,0,0,0.1)' }}>
              <div style={{ display: 'inline-block', padding: '6px 16px', background: '#ef4444', color: '#fff', fontSize: '13px', fontWeight: 'bold', borderRadius: '6px', marginBottom: '20px' }}>
                🔥 官方征稿 / 评审进行中
              </div>
              <h2 style={{ fontSize: '32px', color: '#fbbf24', margin: '0 0 20px 0', fontWeight: '900', letterSpacing: '-0.5px' }}>
                {contestName || 'NAL 年度文学大赏'}
              </h2>
              <div style={{ fontSize: '16px', lineHeight: '2.0', color: '#e5e7eb', background: 'rgba(0,0,0,0.3)', padding: '30px', borderRadius: '12px', whiteSpace: 'pre-wrap', border: '1px solid rgba(255,255,255,0.05)' }}>
                {contestDescription || '具体章程与评审机制正在获取中...'}
              </div>
              
              <div style={{ marginTop: '30px', display: 'flex', gap: '15px' }}>
                {alreadySubmitted ? (
                  <button 
                    onClick={() => setActiveTab('contest')}
                    style={{ padding: '16px 32px', background: '#4f46e5', color: '#fff', fontWeight: 'bold', border: 'none', borderRadius: '8px', cursor: 'pointer', fontSize: '16px', boxShadow: '0 4px 12px rgba(79, 70, 229, 0.3)' }}
                  >
                    ✅ 您已提交本届作品，点击查看档案与进度
                  </button>
                ) : isPastDeadline ? (
                  <button 
                    disabled
                    style={{ padding: '16px 32px', background: '#64748b', color: '#fff', fontWeight: 'bold', border: 'none', borderRadius: '8px', cursor: 'not-allowed', fontSize: '16px' }}
                  >
                    🛑 本届截稿时间已过，提交通道已关闭
                  </button>
                ) : isEligibleForContest ? (
                  <button 
                    onClick={() => setActiveTab('contest')}
                    style={{ padding: '16px 32px', background: '#10b981', color: '#fff', fontWeight: 'bold', border: 'none', borderRadius: '8px', cursor: 'pointer', fontSize: '16px', boxShadow: '0 4px 12px rgba(16, 185, 129, 0.3)' }}
                  >
                    ⚡ 您已获资格，前往正式投稿通道
                  </button>
                ) : (
                  <button 
                    onClick={() => handlePayment('contestant')}
                    style={{ padding: '16px 32px', background: '#10b981', color: '#fff', fontWeight: 'bold', border: 'none', borderRadius: '8px', cursor: 'pointer', fontSize: '16px', boxShadow: '0 4px 12px rgba(16, 185, 129, 0.3)' }}
                  >
                    🚀 立即报名获取参赛资格
                  </button>
                )}
              </div>
            </div>
          ) : activeTab === 'contest' ? (
            <div style={{ display: 'flex', flexDirection: 'row', gap: '2%', alignItems: 'flex-start' }}>
              
              <div style={{...styles.reportBox, width: '68%', boxSizing: 'border-box', padding: '30px', margin: 0 }}>
                {!canSubmitNew ? (
                  <div style={{ textAlign: 'center', padding: '80px 20px', backgroundColor: '#f8fafc', borderRadius: '12px', border: '2px dashed #cbd5e1' }}>
                    <div style={{ fontSize: '48px', marginBottom: '20px' }}>🔒</div>
                    <h3 style={{ color: '#1e293b', marginBottom: '15px', fontSize: '20px' }}>
                      {!isContestActive ? '当前赛季未开放' : 
                        (!isEligibleForContest ? '您未获得参赛资格' : 
                          (alreadySubmitted ? '作品大典已封存' : '本届征稿通道已关闭'))}
                    </h3>
                    <p style={{ color: '#64748b', fontSize: '15px', lineHeight: '1.8', maxWidth: '400px', margin: '0 auto' }}>
                      {!isContestActive
                        ? '本届赛事大闸已休眠，此处仅供查看历史战绩。'
                        : (!isEligibleForContest
                          ? '请在左侧“大赛官方动态”中获取本届赛事的门票资格。'
                          : (alreadySubmitted 
                            ? '您的作品已进入评审矩阵不可更改。请在右侧关注实时进度。' 
                            : '截稿时间已过。目前已全面进入紧张的 AI 离线评审与专家会诊阶段，右侧为您的参展档案。'))}
                    </p>
                  </div>
                ) : (
                  <>
                    <div style={{ marginTop: '0px' }}>
                      <label style={{ display: 'block', fontSize: '14px', fontWeight: 'bold', color: '#374151', marginBottom: '8px' }}>作品正文 (最大 800 字)</label>
                      <textarea 
                        style={{ ...styles.textarea, height: '380px', width: '100%', boxSizing: 'border-box', backgroundColor: '#f9fafb', resize: 'none' }}
                        placeholder="在此粘贴您的参赛作品文字内容..."
                        value={contestText}
                        onChange={(e) => { if (e.target.value.length <= 800) setContestText(e.target.value); }}
                      />
                      <div style={{ textAlign: 'right', fontSize: '12px', color: contestText.length >= 800 ? '#ef4444' : '#94a3b8', marginTop: '5px' }}>
                        {contestText.length} / 800 字
                      </div>
                    </div>

                    <div style={{ marginTop: '20px' }}>
                      <label style={{ display: 'block', fontSize: '14px', fontWeight: 'bold', color: '#374151', marginBottom: '10px' }}>
                        作品插画 (需 1-2 幅，单张限制 <strong>{maxImageSizeMB}MB</strong>)
                      </label>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                        {contestImages.map((file, index) => (
                          <div key={index} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 15px', backgroundColor: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '8px' }}>
                            <span style={{ fontSize: '13px', color: '#166534', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '80%' }}>
                              🖼️ {file.name} ({(file.size / 1024 / 1024).toFixed(1)}MB)
                            </span>
                            <button onClick={() => removeContestImage(index)} style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: '12px', fontWeight: 'bold' }}>移除</button>
                          </div>
                        ))}
                        {contestImages.length < 2 && (
                          <div style={{...styles.uploadArea, padding: '15px'}}>
                            <input type="file" id="c-img" hidden multiple accept="image/*" onChange={handleContestImageUpload} />
                            <label htmlFor="c-img" style={{...styles.uploadBtn, fontSize: '13px'}}>{contestImages.length === 0 ? "➕ 上传第一幅插画" : "➕ 上传第二幅插画"}</label>
                          </div>
                        )}
                      </div>
                    </div>

                    <button 
                      onClick={submitContestWork} 
                      disabled={isSubmitting} 
                      style={{ ...styles.submitBtn, width: '100%', marginTop: '30px', backgroundColor: '#4f46e5', cursor: 'pointer' }}
                    >
                      {isSubmitting ? "正在封存上传中..." : "📤 确认提交参赛作品"}
                    </button>
                  </>
                )}
              </div>

              <div style={{...styles.reportBox, width: '30%', boxSizing: 'border-box', padding: '20px', margin: 0, backgroundColor: '#f8fafc' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
                  <h4 style={{ margin: 0, color: '#334155', fontSize: '14px' }}>📊 本届战绩档案</h4>
                  <div style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#10b981', animation: 'pulse 2s infinite' }}></div>
                </div>

                {userSubmissions.length === 0 ? (
                  <p style={{fontSize: '12px', color: '#94a3b8', textAlign: 'center', padding: '20px 0'}}>暂无记录</p>
                ) : (
                  <div style={{display: 'flex', flexDirection: 'column', gap: '10px'}}>
                    {userSubmissions.map(sub => {
                      const isExhibitionReady = sub.exhibition_ready || sub.is_manual_recommended;
                      return (
                        <div key={sub.id} style={{padding: '12px', background: 'white', borderRadius: '8px', border: '1px solid #e2e8f0', boxShadow: '0 2px 4px rgba(0,0,0,0.02)'}}>
                          <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px'}}>
                            <span style={{fontSize: '11px', color: '#94a3b8'}}>{new Date(sub.created_at).toLocaleDateString()}</span>
                            {isExhibitionReady ? (
                              <span style={{ backgroundColor: '#fbbf24', color: '#78350f', padding: '4px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: 'bold', border: '1px solid #f59e0b' }}>
                                🏆 成功入展
                              </span>
                            ) : (
                              renderStatusBadge(sub.status)
                            )}
                          </div>
                          <div style={{fontSize: '11px', fontWeight: 'bold', color: '#1e293b', fontFamily: 'monospace'}}>ID: {sub.id.substring(0,8)}</div>
                          
                          {(sub.status === 'success' || sub.status === 'selected') && sub.ai_total_score > 0 && (
                            <div style={{fontSize: '12px', color: '#10b981', marginTop: '6px', fontWeight: 'bold'}}>评分: {sub.ai_total_score.toFixed(1)}</div>
                          )}
                          {sub.status === 'rejected' && sub.ai_total_score > 0 && (
                            <div style={{fontSize: '12px', color: '#64748b', marginTop: '6px', fontWeight: 'bold'}}>评分: {sub.ai_total_score.toFixed(1)}</div>
                          )}
                          {sub.status === 'invalid' && sub.error_msg && (
                            <div style={{fontSize: '10px', color: '#ef4444', marginTop: '6px', lineHeight: '1.4'}}>⚠️ {sub.error_msg}</div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
                
                <button 
                  onClick={fetchUserSubmissions} 
                  disabled={isRefreshing}
                  style={{marginTop: '15px', width: '100%', padding: '8px', background: '#fff', border: '1px solid #cbd5e1', borderRadius: '6px', fontSize: '11px', cursor: 'pointer', color: '#64748b'}}
                >
                  {isRefreshing ? "同步中..." : "🔄 刷新状态"}
                </button>
              </div>
            </div>
          ) : (
            <div style={{ ...styles.reportBox, margin: 0 }}>
              <div style={{ display: 'flex', gap: '20px', marginBottom: '25px', backgroundColor: '#f8fafc', padding: '16px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                {activeTab !== 'text' && (
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <label style={{ fontSize: '13px', fontWeight: 'bold', color: '#475569' }}>💡 选择专家模型</label>
                    <select value={selectedModelId} onChange={(e) => setSelectedModelId(e.target.value)} style={{ padding: '10px', borderRadius: '6px', border: '1px solid #cbd5e1', backgroundColor: 'white', color: '#1e293b', outline: 'none', cursor: 'pointer' }}>
                      {models.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                    </select>
                    {(() => {
                      const currentModel = models.find(m => m.id === selectedModelId);
                      if (currentModel && currentModel.description) {
                        return (
                          <div style={styles.descCard}>
                            <strong style={styles.descTitle}>📜 学术底色：</strong>
                            <p style={styles.descText}>{currentModel.description}</p>
                          </div>
                        );
                      }
                      return null;
                    })()}
                  </div>
                )}

                {activeTab === 'picturebook' && (
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <label style={{ fontSize: '13px', fontWeight: 'bold', color: '#475569' }}>🎨 选择插画类型</label>
                    <select value={imageType} onChange={(e) => setImageType(e.target.value)} style={{ padding: '10px', borderRadius: '6px', border: '1px solid #cbd5e1', backgroundColor: 'white', color: '#1e293b', outline: 'none', cursor: 'pointer' }}>
                      <option value="picturebook">绘本分镜 analysis</option>
                      <option value="illustration">单幅插画审美</option>
                    </select>
                  </div>
                )}
              </div>

              {activeTab === 'guide' && <p style={styles.helpText}>请在下方输入您的故事灵感、大纲结构或角色设定，NAL AI 专家将为您提供深度的创作指导和理论支持。</p>}
              {activeTab === 'text' && <p style={styles.helpText}>支持直接粘贴正文，或上传 Word 评审文档。限制：每次限上传 <strong>1</strong> 份 .docx 文件，文件大小不超过 <strong style={{color: '#4f46e5'}}>{maxDocSizeDisplay}</strong>。</p>}
              {activeTab === 'picturebook' && <p style={styles.helpText}>请上传绘本插画素材。当前最多允许批量上传 <strong style={{color: '#4f46e5'}}>{maxImageCount}</strong> 张图片，单张大小不超过 <strong style={{color: '#4f46e5'}}>{maxImageSizeMB}MB</strong> (格式：JPG/PNG)。</p>}

              {activeTab === 'picturebook' && (
                <div style={{ marginBottom: '20px' }}>
                  {selectedImages.length > 0 && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '15px', marginBottom: '20px' }}>
                      {selectedImages.map((file, index) => {
                        if (isPro) {
                          return (
                            <div key={index} style={{ display: 'flex', gap: '15px', padding: '15px', backgroundColor: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '12px' }}>
                              <div style={{ width: '25%', display: 'flex', flexDirection: 'column', gap: '8px', borderRight: '1px dashed #cbd5e1', paddingRight: '15px' }}>
                                <span style={{ fontSize: '13px', fontWeight: 'bold', color: '#1e293b' }}>{imageType === 'picturebook' ? `第 ${index + 1} 页 / 跨页` : `第 ${index + 1} 幅插画`}</span>
                                <span style={{ fontSize: '12px', color: '#64748b', wordBreak: 'break-all' }}>📄 {file.name.length > 20 ? `${file.name.substring(0, 15)}...` : file.name}</span>
                                <button onClick={() => removeSelectedImage(index)} style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: '12px', textAlign: 'left', padding: 0, fontWeight: 'bold' }}>❌ 移除此页</button>
                              </div>
                              <div style={{ width: '75%' }}>
                                <textarea
                                  placeholder={imageType === 'picturebook' ? "✍️ [绘本硬性要求] 请输入本跨页对应的文本..." : "✍️ [插画硬性要求] 请输入审美理念..."}
                                  value={imageTexts[index] || ''}
                                  onChange={(e) => handleImageTextChange(index, e.target.value)}
                                  style={{ width: '100%', height: '80px', padding: '10px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '13px', outline: 'none', resize: 'vertical' }}
                                />
                              </div>
                            </div>
                          );
                        } else {
                          return (
                            <div key={index} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 15px', backgroundColor: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '8px' }}>
                              <span style={{ fontSize: '13px', color: '#166534', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '80%' }}>🖼️ [第 {index + 1} 画面] {file.name} ({(file.size / 1024 / 1024).toFixed(1)}MB)</span>
                              <button onClick={() => removeSelectedImage(index)} style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: '12px', fontWeight: 'bold' }}>移除</button>
                            </div>
                          );
                        }
                      })}
                    </div>
                  )}
                  {selectedImages.length < maxImageCount && (
                    <div style={styles.uploadArea}>
                      <input type="file" id="up" hidden multiple onChange={handleImageChange} accept="image/*" />
                      <label htmlFor="up" style={styles.uploadBtn}>➕ 点击上传插画素材 (还可传 {maxImageCount - selectedImages.length} 张)</label>
                    </div>
                  )}
                </div>
              )}
              
              {activeTab === 'text' && (
                <div style={{ ...styles.uploadArea, marginBottom: '20px' }}>
                  <input type="file" id="docx-up" hidden accept=".docx" onChange={handleDocxChange} />
                  <label htmlFor="docx-up" style={styles.uploadBtn}>{selectedDocx ? `✅ 已选择: ${selectedDocx.name}` : "📄 上传 Word 评审文档 (.docx)"}</label>
                </div>
              )}
              
              {!(activeTab === 'picturebook' && isPro) && (
                <>
                  <label style={{ display: 'block', fontSize: '14px', fontWeight: 'bold', color: '#374151', marginBottom: '8px' }}>
                    {activeTab === 'picturebook' ? '插画/绘本补充说明 (可选)' : '正文内容'}
                  </label>
                  <textarea style={{ ...styles.textarea, width: '100%', boxSizing: 'border-box' }} placeholder={activeTab === 'picturebook' ? "可输入文字描述..." : "在此粘贴需要评审的文本..."} value={workText} onChange={(e) => setWorkText(e.target.value)} />
                </>
              )}
              
              {activeTab === 'picturebook' && warningMessage && <div style={{ padding: '12px', backgroundColor: '#fef2f2', borderLeft: '4px solid #ef4444', color: '#991b1b', fontSize: '13px', marginTop: '20px', borderRadius: '4px' }}>{warningMessage}</div>}

              <button 
                onClick={triggerEvaluation} 
                disabled={loading || (activeTab === 'picturebook' && (!isPictureBookValid || selectedImages.length === 0))} 
                style={{ ...styles.submitBtn, width: '100%', marginTop: '20px', backgroundColor: (activeTab === 'picturebook' && (!isPictureBookValid || selectedImages.length === 0)) ? '#94a3b8' : '#111827', cursor: (activeTab === 'picturebook' && (!isPictureBookValid || selectedImages.length === 0)) ? 'not-allowed' : 'pointer' }}
              >
                {loading ? "AI 专家计算中..." : (activeTab === 'picturebook' ? "启动视觉与图文协作评审" : (activeTab === 'guide' ? "启动创作指导" : "启动评审分析"))}
              </button>
            </div>
          )}
        </div>

        {report && activeTab !== 'contest' && activeTab !== 'dynamics' && (
          <div style={styles.reportBox}>
            <h3 style={{marginTop: 0, fontSize: '18px', borderBottom: '1px solid #eee', paddingBottom: '10px'}}>🏛️ NAL 专家分析结果</h3>
            <div style={styles.reportTxt}>{report}</div>
          </div>
        )}
      </main>
      
      <style>{`
        @keyframes pulse { 0% { opacity: 1; transform: scale(1); } 50% { opacity: 0.5; transform: scale(1.02); } 100% { opacity: 1; transform: scale(1); } }
        @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}

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
  roleLabel: { fontSize: '12px', color: '#9ca3af', textAlign: 'center', marginBottom: '18px', wordBreak: 'break-all', padding: '4px', backgroundColor: 'rgba(255,255,255,0.03)', borderRadius: '4px' },
  logoutBtn: { width: '100%', background: '#374151', border: 'none', color: '#f3f4f6', padding: '10px', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold' },
  main: { flex: 1, padding: '30px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '20px' },
  sidebarHeader: {display: 'flex', alignItems: 'center', gap: '10px', padding: '20px 16px', cursor: 'pointer', borderBottom: '1px solid rgba(0, 0, 0, 0.05)', marginBottom: '15px'},
  sidebarLogoImg: {height: '32px', width: 'auto', objectFit: 'contain'},
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', backgroundColor: 'white', padding: '20px 30px', borderRadius: '12px', boxShadow: '0 1px 2px rgba(0,0,0,0.05)' },
  statusRow: { display: 'flex', gap: '30px', alignItems: 'center' },
  statusItem: { display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }, 
  descCard: {backgroundColor: '#f0fdf4', borderLeft: '5px solid #16a34a', padding: '16px', borderRadius: '8px', marginTop: '8px', boxShadow: '0 2px 8px rgba(22, 163, 74, 0.03)'},
  descTitle: {color: '#15803d', fontSize: '14px', fontWeight: 'bold', display: 'block', marginBottom: '6px'},
  descText: {color: '#1e293b', fontSize: '13px', margin: 0, lineHeight: '1.6'},
  statusLabel: { fontSize: '10px', color: '#9ca3af', textTransform: 'uppercase' },
  statusValue: { fontSize: '15px', fontWeight: 'bold', color: '#111827' },
  content: { display: 'flex', flexDirection: 'column', gap: '15px' },
  textarea: { padding: '20px', borderRadius: '12px', border: '1px solid #d1d5db', fontSize: '16px', lineHeight: '1.7', outline: 'none' },
  helpText: { fontSize: '13px', color: '#64748b', marginBottom: '20px', lineHeight: '1.5' },
  uploadArea: { padding: '25px', border: '2px dashed #d1d5db', borderRadius: '12px', textAlign: 'center', backgroundColor: '#f8fafc' },
  uploadBtn: { cursor: 'pointer', color: '#6366f1', fontWeight: 'bold' },
  submitBtn: { padding: '16px', color: 'white', border: 'none', borderRadius: '12px', fontWeight: 'bold' },
  reportBox: { padding: '40px', backgroundColor: 'white', borderRadius: '12px', border: '1px solid #e5e7eb', textAlign: 'left' },
  reportTxt: { whiteSpace: 'pre-wrap', lineHeight: '2.0', color: '#374151', fontSize: '16px' },
  upgradeBox: { backgroundColor: '#1f2937', padding: '16px', borderRadius: '12px', marginBottom: '20px', border: '1px solid #374151' },
  upgradeTitle: { color: '#f9fafb', fontSize: '14px', fontWeight: 'bold', marginTop: '0', marginBottom: '8px' },
  payBtn: { width: '100%', backgroundColor: '#6366f1', color: 'white', border: 'none', padding: '10px', borderRadius: '8px', fontSize: '13px', fontWeight: 'bold', cursor: 'pointer', marginBottom: '8px' },
  addonBtn: { width: '100%', backgroundColor: '#10b981', color: 'white', border: 'none', padding: '10px', borderRadius: '8px', fontSize: '13px', fontWeight: 'bold', cursor: 'pointer', marginBottom: '8px' },
  proBtn: { width: '100%', backgroundColor: 'transparent', color: '#a78bfa', border: '1px solid #a78bfa', padding: '8px', borderRadius: '8px', fontSize: '12px', fontWeight: 'bold', cursor: 'pointer' },
};
