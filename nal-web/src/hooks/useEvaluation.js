import { useState } from 'react';
import { supabase } from '../supabaseClient';

export function useEvaluation(userRole, usage) {
  const [loading, setLoading] = useState(false);
  const [report, setReport] = useState(null);

  // 辅助函数：上传图片到 Supabase Storage
  const uploadImagesToStorage = async (files, userId) => {
    const urls = [];
    for (let file of files) {
      const filePath = `user_uploads/${userId}/${Date.now()}_${file.name}`;
      await supabase.storage.from('nal_images').upload(filePath, file);
      const { data } = supabase.storage.from('nal_images').getPublicUrl(filePath);
      urls.push(data.publicUrl);
    }
    return urls;
  };

  const evaluate = async ({ activeTab, workText, selectedImages, selectedDocx, imageType, selectedModelId }) => {
   const isPro = userRole === 'pro';
    const isContestant = userRole === 'contestant';
    
    // 1. 文档校验 (大小：Pro 200MB, 参赛 150KB, 普通 50KB)
    if (activeTab === 'text') {
      if (!selectedDocx) return alert("文字评审必须上传一个 Word 文档 (.docx)。");
      if (!selectedDocx.name.endsWith('.docx')) return alert("格式错误：仅支持 .docx 文件。");
      
      const maxDocxSize = isPro ? 200 * 1024 * 1024 : (isContestant ? 150 * 1024 : 50 * 1024);
      if (selectedDocx.size > maxDocxSize) {
        return alert(`文件过大！您当前身份最大可上传 ${maxDocxSize / 1024} KB 的文档。`);
      }
    }

    // 2. 图片校验 (数量：Pro 50张, 参赛 5张, 普通 2张 | 大小：5MB, 1.5MB, 1MB)
    if (activeTab === 'illustration') {
      if (selectedImages.length === 0) return alert("请至少上传一张图片");
      
      const maxImgCount = isPro ? 50 : (isContestant ? 5 : 2);
      if (selectedImages.length > maxImgCount) {
        return alert(`数量超限！您当前最多只能上传 ${maxImgCount} 张图片。`);
      }

      const maxImgSize = isPro ? 5 * 1024 * 1024 : (isContestant ? 1.5 * 1024 * 1024 : 1 * 1024 * 1024);
      for (let img of selectedImages) {
        if (img.size > maxImgSize) {
          return alert(`单张图片过大！文件 "${img.name}" 超出了您当前级别 ${maxImgSize / (1024 * 1024)} MB 的单张限制。`);
        }
      }
    }

    if (activeTab === 'illustration' && selectedImages.length === 0) return alert("请上传图片");
    if (activeTab === 'guide' && !workText) return alert("请输入创作构思");

    setLoading(true);
    setReport(null);

    try {
      const { data: { session: currentSession } } = await supabase.auth.getSession();
      if (!currentSession) throw new Error("会话过期");

      let publicImageUrls = [];
      if (activeTab === 'illustration') {
        publicImageUrls = await uploadImagesToStorage(selectedImages, currentSession.user.id);
      }

      // 2. 使用 FormData 传输（因为需要同时传文本参数和 Docx 文件体）
      const formData = new FormData();
      formData.append('task_type', activeTab);
      formData.append('user_role', userRole);
      formData.append('work_text', workText);
      formData.append('image_type', activeTab === 'illustration' ? imageType : '');
      formData.append('model_db_id', activeTab === 'illustration' ? '' : selectedModelId);
      
      // 传递参赛选手是否还有余量，用于后端判断字数和模型
      const hasProLimit = usage[`${activeTab}_pro`] > 0;
      formData.append('has_pro_limit', hasProLimit ? "true" : "false");

      if (activeTab === 'illustration') {
        formData.append('image_urls', JSON.stringify(publicImageUrls));
      }
      if (activeTab === 'text' && selectedDocx) {
        formData.append('file', selectedDocx);
      }

      const response = await fetch(`${import.meta.env.VITE_API_BASE_URL}/api/v1/evaluate/process`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${currentSession.access_token}`
          // 注意：使用 FormData 时，浏览器会自动设置 multipart/form-data 和 boundary，千万不要手动写 Content-Type
        },
        body: formData
      });

      const resData = await response.json();
      if (!response.ok) throw new Error(resData.detail || "请求失败");
      
      setReport(resData.report);
      return true; // 成功标志

    } catch (error) {
      alert(`分析中断: ${error.message}`);
      return false;
    } finally {
      setLoading(false);
    }
  };

  return { loading, report, evaluate };
}