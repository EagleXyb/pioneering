import React from 'react';

const tools = [
  {
    id: 1,
    title: '网页获取',
    description: '研读在线论文，产出论文综述的文档',
    icon: (
      <svg width="48" height="48" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect x="8" y="8" width="48" height="48" rx="5" fill="#F5F7FA"/>
        <path d="M20 18h24v4H20zM20 30h16v4H20zM20 42h24v4H20z" fill="#9CA3AF"/>
        <circle cx="36" cy="30" r="8" stroke="#60A5FA" strokeWidth="2"/>
        <path d="M41 35l3 3" stroke="#60A5FA" strokeWidth="2" strokeLinecap="round"/>
      </svg>
    )
  },
  {
    id: 2,
    title: '调研分析',
    description: '调研多个短视频平台，生成汇报PPT',
    icon: (
      <svg width="48" height="48" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect x="8" y="8" width="48" height="48" rx="5" fill="#F5F7FA"/>
        <rect x="16" y="16" width="32" height="32" rx="4" fill="white" stroke="#E5E7EB"/>
        <rect x="20" y="20" width="12" height="12" rx="2" fill="#F87171"/>
        <path d="M24 26l3 3 6-6" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
        <rect x="20" y="36" width="24" height="4" rx="1" fill="#E5E7EB"/>
      </svg>
    )
  },
  {
    id: 3,
    title: '数据挖掘',
    description: '挖掘市场增长数据，分析数据发展趋势',
    icon: (
      <svg width="48" height="48" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect x="8" y="8" width="48" height="48" rx="5" fill="#F5F7FA"/>
        <rect x="18" y="36" width="8" height="16" rx="2" fill="#60A5FA"/>
        <rect x="28" y="28" width="8" height="24" rx="2" fill="#60A5FA"/>
        <rect x="38" y="20" width="8" height="32" rx="2" fill="#60A5FA"/>
        <circle cx="18" cy="34" r="2" fill="#22C55E"/>
        <circle cx="28" cy="26" r="2" fill="#22C55E"/>
        <circle cx="38" cy="18" r="2" fill="#22C55E"/>
        <path d="M18 34L28 26L38 18" stroke="#22C55E" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    )
  },
  {
    id: 4,
    title: '文件管理',
    description: '整理本地文件夹，列出Excel清单',
    icon: (
      <svg width="48" height="48" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M12 20V48a4 4 0 004 4h32a4 4 0 004-4V16a4 4 0 00-4-4H28l-4-4H16a4 4 0 00-4 4v12z" fill="#60A5FA"/>
        <path d="M12 20h36a4 4 0 014 4v24a4 4 0 01-4 4H16a4 4 0 01-4-4V20z" fill="#3B82F6"/>
        <rect x="20" y="32" width="24" height="16" rx="5" fill="white"/>
        <rect x="24" y="36" width="16" height="2" rx="1" fill="#E5E7EB"/>
        <rect x="24" y="40" width="12" height="2" rx="1" fill="#E5E7EB"/>
      </svg>
    )
  }
];

export default tools;
