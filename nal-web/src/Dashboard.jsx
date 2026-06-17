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

  // --- 报名与规则确认大闸状态 ---
  const [showRegModal, setShowRegModal] = useState(false);
  const [isUpdatingReg, setIsUpdatingReg] = useState(false);
  const [regForm, setRegForm] = useState({
    name: '',
    gender: '保密',
    phone: '',
    agreed: false
  });

  // 🚨 全局 AI 辅助强制声明状态 (''=未选择, 'no'=未使用, 'yes'=已使用)
  const [aiDeclaration, setAiDeclaration] = useState(''); 

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
    flash: initialMeta.flash_left !== undefined ? initialMeta.flash_left : 3, 
    pro_credits: initialMeta.pro_credits || 0
  });

  // 身份确权判定，拦截管理员误入普通用户控制台
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

  // --- 判断用户是否已经报名并同意当前赛季规则 ---
  const hasAgreedToCurrentContest = rawUserMetadata.agreed_contests?.includes(activeContestId);

  // 3. 额度动态洗白
  const displayUsage = {
    flash: (isProExpired && usage.flash >= 9999) ? 3 : Math.max(0, Number(usage.flash || 0)),
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
    if (isAdmin) return;
    const { data: { session: currentSession } } = await supabase.auth.refreshSession();
    const user = currentSession?.user || session?.user;
    if (user) {
      let meta = user.user_metadata || {};
      if (meta.flash_left === undefined) {
        const { data, error } = await supabase.auth.updateUser({ data: { flash_left: 3 } }); 
        if (!error && data?.user) meta = data.user.user_metadata;
      }
      setRawUserMetadata(meta);
      setUsage({
        flash: meta.flash_left !== undefined ? meta.flash_left : 3,
        pro_credits: meta.pro_credits || 0
      });
      // 初始化报名表单数据
      setRegForm(prev => ({
        ...prev,
        name: meta.real_name || '',
        gender: meta.gender || '保密',
        phone: meta.phone || ''
      }));
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

  // 处理报名信息提交
  const handleRegisterSubmit = async () => {
    if (!regForm.name.trim() || !regForm.phone.trim()) {
      return alert("请填写完整的姓名和联系电话，以便获奖后与您取得联系。");
    }
    
    setIsUpdatingReg(true);
    try {
      const updatedAgreedContests = [...(rawUserMetadata.agreed_contests || []), activeContestId];
      
      const { data, error } = await supabase.auth.updateUser({
        data: {
          real_name: regForm.name,
          gender: regForm.gender,
          phone: regForm.phone,
          agreed_contests: updatedAgreedContests
        }
      });
      
      if (error) throw error;
      
      setRawUserMetadata(data.user.user_metadata);
      setShowRegModal(false); // 提交成功，关闭弹窗，瞬间解锁上传大厅
    } catch (error) {
      alert("信息提交失败: " + error.message);
    } finally {
      setIsUpdatingReg(false);
    }
  };

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
      activeTab, 
      workText, 
      selectedImages, 
      selectedDocx, 
      imageType, 
      selectedModelId, 
      page_texts_json: pageTextsJson,
      has_declared_ai: aiDeclaration === 'yes' // 🚨 明确判定是否使用了 AI
    });
    setTimeout(refreshUserMetadata, 1500);
    if (success) {
      setWorkText(''); 
      setSelectedImages([]);
      setImageTexts([]);
      setSelectedDocx(null);
      setAiDeclaration(''); // 提交成功后重置选项
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
        contest_id: targetContestId,
        has_declared_ai: aiDeclaration === 'yes' // 🚨 将 AI 声明正式入库
      });
      if (dbError) throw dbError;

      alert("🎉 提交成功！您的作品已封存并进入智能评审大阵，请在右侧追踪进度。");
      setContestText('');
      setContestImages([]);
      setAiDeclaration(''); // 提交成功后重置选项
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
            onClick={() => navigate('/admin')} 
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

  const alreadySubmitted = userSubmissions.some(s => s.status !== 'invalid');
  const now = new Date();
  const isPastDeadline = submissionDeadline ? now > new Date(submissionDeadline) : false;
  const canSubmitNew = isContestActive && isEligibleForContest && !alreadySubmitted && !isPastDeadline;

  // 🌟 核心引擎显示策略：优先展示并消耗 Pro 额度
  const engineName = isPro ? "文学专业旗舰版" : 
                     (displayUsage.pro_credits > 0 ? "高级版 (优先消耗 Pro 额度)" : 
                     (isContestant ? "高级文学引擎" : "基础版"));

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
      {/* 支付状态遮罩层 */}
      {payLoading && (
        <div style={styles.overlay}>
          <div style={styles.paymentModal}>
            <div style={styles.spinner}></div>
            <h3 style={{ margin: '20px 0 10px 0', color: '#111827' }}>正在连接支付网关...</h3>
            <button onClick={() => setPayLoading(false)} style={styles.cancelPayBtn}>返回</button>
          </div>
        </div>
      )}

      {/* 报名与参赛规则确认弹窗 */}
      {showRegModal && (
        <div style={styles.overlay}>
          <div style={{...styles.paymentModal, maxWidth: '550px', textAlign: 'left', padding: '35px'}}>
            <h3 style={{ margin: '0 0 20px 0', color: '#111827', borderBottom: '1px solid #e5e7eb', paddingBottom: '15px', fontSize: '20px' }}>
              📝 完善报名信息与参赛声明
            </h3>
            
            <div style={{ marginBottom: '16px' }}>
              <label style={styles.regLabel}>真实姓名 <span style={{color: '#ef4444'}}>*</span></label>
              <input type="text" style={styles.regInput} value={regForm.name} onChange={e => setRegForm({...regForm, name: e.target.value})} placeholder="请输入您的真实姓名" />
            </div>
            
            <div style={{ marginBottom: '20px', display: 'flex', gap: '15px' }}>
              <div style={{ flex: 1 }}>
                <label style={styles.regLabel}>性别</label>
                <select style={styles.regInput} value={regForm.gender} onChange={e => setRegForm({...regForm, gender: e.target.value})}>
                  <option value="保密">保密</option>
                  <option value="男">男</option>
                  <option value="女">女</option>
                </select>
              </div>
              <div style={{ flex: 2 }}>
                <label style={styles.regLabel}>联系电话 <span style={{color: '#ef4444'}}>*</span></label>
                <input type="tel" style={styles.regInput} value={regForm.phone} onChange={e => setRegForm({...regForm, phone: e.target.value})} placeholder="非常重要，用于入围与发奖联系" />
              </div>
            </div>

            <label style={styles.regLabel}>大赛参赛规则与版权声明</label>
            <div style={styles.rulesBox}>
              <p>1. <strong>原创性声明</strong>：参赛作品必须为参赛者本人绝对原创，严禁任何形式的抄袭、洗稿或剽窃。若因版权侵权引发法律纠纷，一切后果及法律责任由参赛者本人承担。</p>
              <p>2. <strong>AI 生成限制</strong>：本平台旨在发掘人类真实的文学情感。严禁直接提交由 ChatGPT、文心一言等 AI 工具自动生成的作品。我们的后台评审引擎包含深度的“去人造化与 AI 痕迹筛查”，一经判定为 AI 纯生成，将直接取消入展资格。</p>
              <p>3. <strong>版权与使用权归属</strong>：参赛作品的完整著作权（含署名权）永远归创作者所有。但报名并提交作品即视为参赛者**同意并授权** NAL Collective 在其官方平台、线上展厅、相关社交媒体及宣传物料中，非排他性地展示、发表及使用该作品。</p>
              <p>4. <strong>唯一投递原则</strong>：为保证评审资源的合理分配，每位参赛账户在单个赛季期间，限定只能投递一部完整的代表作品。作品一经点击提交并进入 AI 矩阵，即不可撤回或修改，请务必确认至最终版再提交。</p>
            </div>

            <label style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', marginTop: '20px', fontSize: '13px', cursor: 'pointer', color: '#1f2937', userSelect: 'none' }}>
              <input type="checkbox" checked={regForm.agreed} onChange={e => setRegForm({...regForm, agreed: e.target.checked})} style={{ marginTop: '2px', transform: 'scale(1.2)', cursor: 'pointer' }} />
              <span style={{ lineHeight: '1.5' }}>我已仔细阅读并完全理解、同意上述《NAL Collective 参赛规则与版权声明》。</span>
            </label>

            <div style={{ display: 'flex', gap: '12px', marginTop: '30px' }}>
              <button onClick={() => setShowRegModal(false)} style={{...styles.cancelPayBtn, flex: 1}}>取消返回</button>
              <button 
                onClick={handleRegisterSubmit} 
                disabled={isUpdatingReg || !regForm.agreed} 
                style={{...styles.submitBtn, flex: 2, padding: '12px', backgroundColor: (!regForm.agreed || isUpdatingReg) ? '#94a3b8' : '#4f46e5', cursor: (!regForm.agreed || isUpdatingReg) ? 'not-allowed' : 'pointer', marginTop: 0}}
              >
                {isUpdatingReg ? '信息提交中...' : '确认同意并前往上传大厅'}
              </button>
            </div>
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
                {/* 拦截1：未获取资格、未开赛或已提交 */}
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
                ) : 
                
                /* 拦截2：有参赛资格，但尚未同意【本届规则】。展示报名引导卡片 */
                !hasAgreedToCurrentContest ? (
                  <div style={{ textAlign: 'center', padding: '60px 20px', backgroundColor: '#f0f9ff', borderRadius: '12px', border: '2px dashed #bae6fd' }}>
                    <div style={{ fontSize: '48px', marginBottom: '20px' }}>✍️</div>
                    <h3 style={{ color: '#0369a1', marginBottom: '15px', fontSize: '20px' }}>
                      最后一步：完善报名信息并确认规则
                    </h3>
                    <p style={{ color: '#0c4a6e', fontSize: '15px', lineHeight: '1.8', maxWidth: '450px', margin: '0 auto 30px auto' }}>
                      系统检测到您已获得本届大赛的参选资格。在正式解锁上传大厅之前，我们需要您登记联系方式，并确认大赛的版权与原创声明。
                    </p>
                    <button 
                      onClick={() => setShowRegModal(true)} 
                      style={{ padding: '14px 32px', backgroundColor: '#0284c7', color: '#fff', border: 'none', borderRadius: '8px', fontWeight: 'bold', cursor: 'pointer', fontSize: '15px', boxShadow: '0 4px 10px rgba(2, 132, 199, 0.3)' }}
                    >
                      📝 立即填写报名信息
                    </button>
                  </div>
                ) : 

                /* 拦截3：已同意规则，一切就绪，展示正式上传大厅 */
                (
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

                    {/* 🚨 参赛作品专属 AI 声明 (带强烈警告样式) */}
                    <div style={{ marginTop: '20px', padding: '15px', backgroundColor: '#fef2f2', borderRadius: '8px', border: '1px solid #fecaca' }}>
                      <label style={{ display: 'block', fontSize: '14px', fontWeight: 'bold', color: '#991b1b', marginBottom: '10px' }}>
                        🚨 参赛诚信与 AI 辅助声明 <span style={{ color: '#ef4444' }}>* (必选)</span>
                      </label>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', fontSize: '13px', color: '#7f1d1d' }}>
                        <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
                          <input type="radio" name="contest_ai_dec" checked={aiDeclaration === 'no'} onChange={() => setAiDeclaration('no')} style={{ cursor: 'pointer' }} />
                          <span>我郑重声明：本作品为纯人类原创，未使用任何 AI 工具。（若被检测出高度 AI 生成，直接落选）</span>
                        </label>
                        <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
                          <input type="radio" name="contest_ai_dec" checked={aiDeclaration === 'yes'} onChange={() => setAiDeclaration('yes')} style={{ cursor: 'pointer' }} />
                          <span>我如实声明：本作品在创作过程中使用了 AI 工具进行辅助/润色。（允许适度辅助，拒绝全篇代写）</span>
                        </label>
                      </div>
                    </div>

                    <button 
                      onClick={submitContestWork} 
                      disabled={isSubmitting || aiDeclaration === ''} 
                      style={{ ...styles.submitBtn, width: '100%', marginTop: '30px', backgroundColor: (isSubmitting || aiDeclaration === '') ? '#94a3b8' : '#4f46e5', cursor: (isSubmitting || aiDeclaration === '') ? 'not-allowed' : 'pointer' }}
                    >
                      {isSubmitting ? "正在封存上传中..." : (aiDeclaration === '' ? "⛔ 请先勾选上方 AI 声明" : "📤 确认提交参赛作品")}
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
                {activeTab !== 'picturebook' && (
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
                      <option value="picturebook">绘本分镜分析</option>
                      <option value="illustration">单幅插画审美</option>
                    </select>
                  </div>
                )}
              </div>

              {activeTab === 'guide' && <p style={styles.helpText}>请在下方输入您的故事灵感、大纲结构或角色设定，NAL AI 专家将为您提供深度的创作指导和理论支持。</p>}
              
              {/* 🚨 针对 text 模式的特定文案更新 */}
              {activeTab === 'text' && <p style={styles.helpText}>请上传 Word 评审文档。限制：每次限上传 <strong>1</strong> 份 .docx 文件，文件大小不超过 <strong style={{color: '#4f46e5'}}>{maxDocSizeDisplay}</strong>。</p>}
              
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
                                  placeholder={imageType === 'picturebook' ? "✍️ [绘本硬要求] 请输入本跨页对应的文本..." : "✍️ [插画硬性要求] 请输入审美理念..."}
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
              
              {/* 🚨 针对 guide 和非 pro 的 picturebook 保留文本输入框，对 text 彻底隐藏 */}
              {(activeTab === 'guide' || (activeTab === 'picturebook' && !isPro)) && (
                <>
                  <label style={{ display: 'block', fontSize: '14px', fontWeight: 'bold', color: '#374151', marginBottom: '8px' }}>
                    {activeTab === 'picturebook' ? '插画/绘本补充说明 (可选)' : '大纲与设定内容'}
                  </label>
                  <textarea style={{ ...styles.textarea, width: '100%', boxSizing: 'border-box' }} placeholder={activeTab === 'picturebook' ? "可输入文字描述..." : "在此输入需要指导的故事灵感或大纲..."} value={workText} onChange={(e) => setWorkText(e.target.value)} />
                </>
              )}
              
              {/* 🚨 常规文字与绘本插画的全局 AI 声明选项 (强制要求勾选单选框) */}
              {(activeTab === 'text' || activeTab === 'picturebook') && (
                <div style={{ marginTop: '20px', padding: '15px', backgroundColor: '#f8fafc', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                  <label style={{ display: 'block', fontSize: '13px', fontWeight: 'bold', color: '#1e293b', marginBottom: '10px' }}>
                    🤖 AI 辅助创作声明 <span style={{ color: '#ef4444' }}>* (必选)</span>
                  </label>
                  <div style={{ display: 'flex', gap: '20px', fontSize: '13px', color: '#475569' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
                      <input type="radio" name="general_ai_dec" checked={aiDeclaration === 'no'} onChange={() => setAiDeclaration('no')} style={{ cursor: 'pointer' }} />
                      <span>纯人类原创，未使用 AI 工具</span>
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
                      <input type="radio" name="general_ai_dec" checked={aiDeclaration === 'yes'} onChange={() => setAiDeclaration('yes')} style={{ cursor: 'pointer' }} />
                      <span>使用了 AI 工具进行辅助</span>
                    </label>
                  </div>
                </div>
              )}

              {activeTab === 'picturebook' && warningMessage && <div style={{ padding: '12px', backgroundColor: '#fef2f2', borderLeft: '4px solid #ef4444', color: '#991b1b', fontSize: '13px', marginTop: '20px', borderRadius: '4px' }}>{warningMessage}</div>}

              {/* 🚨 按钮动态控制逻辑：如果没选 AI 声明，或在 text 模式没传文件，按钮变灰且不让点击 */}
              {(() => {
                const isEvalDisabled = loading || 
                  (activeTab === 'picturebook' && (!isPictureBookValid || selectedImages.length === 0)) ||
                  (activeTab === 'text' && !selectedDocx) || // 🚨 新增拦截：文字评审模式必须传 Word
                  ((activeTab === 'text' || activeTab === 'picturebook') && aiDeclaration === '');

                let btnText = "启动评审分析";
                if (loading) btnText = "AI 专家计算中...";
                else if ((activeTab === 'text' || activeTab === 'picturebook') && aiDeclaration === '') btnText = "⛔ 请先完成上方 AI 声明";
                else if (activeTab === 'text' && !selectedDocx) btnText = "⛔ 请先上传 Word 评审文档"; // 🚨 明确的未传文档提示
                else if (activeTab === 'picturebook') btnText = "启动视觉与图文协作评审";
                else if (activeTab === 'guide') btnText = "启动创作指导";

                return (
                  <button 
                    onClick={triggerEvaluation} 
                    disabled={isEvalDisabled} 
                    style={{ ...styles.submitBtn, width: '100%', marginTop: '20px', backgroundColor: isEvalDisabled ? '#94a3b8' : '#111827', cursor: isEvalDisabled ? 'not-allowed' : 'pointer' }}
                  >
                    {btnText}
                  </button>
                );
              })()}
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
  overlay: { position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.6)', display: 'flex', zIndex: 1000, backdropFilter: 'blur(3px)' },
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
  regLabel: { display: 'block', fontSize: '13px', fontWeight: 'bold', color: '#374151', marginBottom: '6px' },
  regInput: { width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid #d1d5db', outline: 'none', fontSize: '14px', boxSizing: 'border-box' },
  rulesBox: { backgroundColor: '#f8fafc', padding: '15px', borderRadius: '8px', border: '1px solid #e2e8f0', fontSize: '12px', color: '#475569', height: '140px', overflowY: 'auto', lineHeight: '1.6' }
};
