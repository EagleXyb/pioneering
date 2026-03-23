import React, { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { useUser } from '../contexts/UserContext';

const API_BASE = 'http://localhost:3000/api';

interface ProfileData {
  id?: number;
  name: string;
  email: string;
  phone: string;
  location: string;
  bio: string;
  company: string;
  position: string;
  joinDate: string;
  skills: string[];
  achievements: { label: string; value: string }[];
}

const defaultProfile: ProfileData = {
  name: '张三',
  email: 'zhangsan@example.com',
  phone: '138-0000-0000',
  location: '北京市海淀区',
  bio: '热爱创新，专注于产品设计和用户体验。致力于通过科技改变生活，让世界变得更美好。',
  company: '创新科技有限公司',
  position: '产品经理',
  joinDate: '2024-01-15',
  skills: ['产品设计', '用户体验', '创新思维', '项目管理', '数据分析'],
  achievements: [
    { label: '完成测评', value: '12' },
    { label: '创新项目', value: '8' },
    { label: '获得徽章', value: '15' },
    { label: '积分', value: '2,580' },
  ],
};

const Profile: React.FC = () => {
  const { userState, setAvatar, setName } = useUser();
  const [isEditing, setIsEditing] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [userInfo, setUserInfo] = useState<ProfileData>(defaultProfile);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (userState.isLoggedIn && userState.email) {
      fetchProfile();
    } else {
      setIsLoading(false);
    }
  }, [userState.isLoggedIn, userState.email]);

  const fetchProfile = async () => {
    try {
      setIsLoading(true);
      setError(null);
      const response = await fetch(`${API_BASE}/profile/email/${userState.email}`);
      if (response.ok) {
        const data = await response.json();
        if (data) {
          setUserInfo({
            ...data,
            joinDate: data.joinDate ? new Date(data.joinDate).toISOString().split('T')[0] : defaultProfile.joinDate,
            skills: data.skills || defaultProfile.skills,
            achievements: defaultProfile.achievements,
          });
          if (data.avatar) {
            setAvatar(data.avatar);
          }
          if (data.name) {
            setName(data.name);
          }
        }
      }
    } catch (err) {
      console.error('获取个人信息失败:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSave = async () => {
    try {
      setError(null);
      const { achievements, joinDate, ...profileData } = userInfo;
      const response = await fetch(`${API_BASE}/profile/upsert`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(profileData),
      });
      if (response.ok) {
        setIsEditing(false);
        setName(userInfo.name); // 更新全局用户名
        await fetchProfile();
      } else {
        setError('保存失败，请重试');
      }
    } catch (err) {
      console.error('保存个人信息失败:', err);
      setError('保存失败，请检查网络连接');
    }
  };

  const handleAvatarClick = () => {
    if (isEditing) {
      fileInputRef.current?.click();
    }
  };

  const handleAvatarChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (!file.type.startsWith('image/')) {
        alert('请选择图片文件');
        return;
      }

      if (file.size > 10 * 1024 * 1024) {
        alert('图片大小不能超过 10MB');
        return;
      }

      const formData = new FormData();
      formData.append('avatar', file);

      try {
        const response = await fetch(`${API_BASE}/profile/avatar/${userState.email}`, {
          method: 'POST',
          body: formData,
        });

        if (response.ok) {
          const data = await response.json();
          setAvatar(data.avatar);
          console.log('头像上传成功');
        } else {
          const errorData = await response.json();
          alert(errorData.message || '头像保存失败，请重试');
        }
      } catch (error) {
        console.error('保存头像失败:', error);
        alert('保存头像失败，请检查网络连接');
      }
    }
    
    e.target.value = '';
  };

  if (isLoading) {
    return (
      <div className="profile-container">
        <nav className="nav">
          <div className="nav-content">
            <Link to="/" className="nav-back">
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                <path d="M13 4L7 10L13 16" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
              </svg>
              <span>返回首页</span>
            </Link>
            <h1 className="nav-title">个人信息</h1>
          </div>
        </nav>
        <main className="main">
          <div className="main-content" style={{ textAlign: 'center', padding: '100px 0' }}>
            <p>加载中...</p>
          </div>
        </main>
      </div>
    );
  }

  if (!userState.isLoggedIn) {
    return (
      <div className="profile-container">
        <nav className="nav">
          <div className="nav-content">
            <Link to="/" className="nav-back">
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                <path d="M13 4L7 10L13 16" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
              </svg>
              <span>返回首页</span>
            </Link>
            <h1 className="nav-title">个人信息</h1>
          </div>
        </nav>
        <main className="main">
          <div className="main-content" style={{ textAlign: 'center', padding: '100px 0' }}>
            <p>请先登录</p>
            <Link to="/" style={{ color: '#0071E3', textDecoration: 'none', marginTop: '16px', display: 'inline-block' }}>
              返回首页登录
            </Link>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="profile-container">
      <nav className="nav">
        <div className="nav-content">
          <Link to="/" className="nav-back">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              <path d="M13 4L7 10L13 16" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
            </svg>
            <span>返回首页</span>
          </Link>
          <h1 className="nav-title">个人信息</h1>
          <button
            className="nav-action"
            onClick={() => setIsEditing(!isEditing)}
          >
            {isEditing ? '取消' : '编辑'}
          </button>
        </div>
      </nav>

      <main className="main">
        <div className="main-content">
          {error && (
            <div style={{ padding: '12px', background: '#fee', color: '#c00', borderRadius: '8px', marginBottom: '16px' }}>
              {error}
            </div>
          )}

          <section className="profile-header">
            <div className="avatar-section">
              <div className="avatar" onClick={handleAvatarClick} style={{ cursor: isEditing ? 'pointer' : 'default' }}>
                {userState.avatar ? (
                  <img 
                    src={userState.avatar} 
                    alt="用户头像" 
                    className="avatar-image"
                    onError={(e) => {
                      console.error('头像加载失败');
                      e.currentTarget.style.display = 'none';
                    }}
                  />
                ) : (
                  <div className="avatar-placeholder">
                    {userInfo.name.charAt(0)}
                  </div>
                )}
                {isEditing && (
                  <button className="avatar-edit" type="button">
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                      <path d="M11.5 2.5L13.5 4.5L5 13H3V11L11.5 2.5Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/>
                    </svg>
                  </button>
                )}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleAvatarChange}
                  style={{ display: 'none' }}
                />
              </div>
              <div className="user-basic">
                {isEditing ? (
                  <input
                    type="text"
                    value={userInfo.name}
                    onChange={(e) => setUserInfo({...userInfo, name: e.target.value})}
                    className="name-input"
                  />
                ) : (
                  <h2 className="user-name">{userInfo.name}</h2>
                )}
                <p className="user-title">{userInfo.position} · {userInfo.company}</p>
              </div>
            </div>
          </section>

          <section className="stats-section">
            <div className="stats-grid">
              {userInfo.achievements.map((stat, index) => (
                <div key={index} className="stat-card">
                  <div className="stat-value">{stat.value}</div>
                  <div className="stat-label">{stat.label}</div>
                </div>
              ))}
            </div>
          </section>

          <section className="info-section">
            <div className="info-card">
              <h3 className="info-title">基本信息</h3>
              <div className="info-grid">
                <div className="info-item">
                  <div className="info-label">
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                      <path d="M2 3h12v10H2V3z" stroke="currentColor" strokeWidth="1.5"/>
                      <path d="M2 6h12" stroke="currentColor" strokeWidth="1.5"/>
                    </svg>
                    <span>邮箱</span>
                  </div>
                  {isEditing ? (
                    <input
                      type="email"
                      value={userInfo.email}
                      onChange={(e) => setUserInfo({...userInfo, email: e.target.value})}
                      className="info-input"
                    />
                  ) : (
                    <div className="info-value">{userInfo.email}</div>
                  )}
                </div>

                <div className="info-item">
                  <div className="info-label">
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                      <path d="M3 2h10v12l-5-3-5 3V2z" stroke="currentColor" strokeWidth="1.5"/>
                    </svg>
                    <span>电话</span>
                  </div>
                  {isEditing ? (
                    <input
                      type="tel"
                      value={userInfo.phone}
                      onChange={(e) => setUserInfo({...userInfo, phone: e.target.value})}
                      className="info-input"
                    />
                  ) : (
                    <div className="info-value">{userInfo.phone}</div>
                  )}
                </div>

                <div className="info-item">
                  <div className="info-label">
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                      <path d="M8 8a3 3 0 100-6 3 3 0 000 6z" stroke="currentColor" strokeWidth="1.5"/>
                      <path d="M2 14c0-3.3 2.7-6 6-6s6 2.7 6 6" stroke="currentColor" strokeWidth="1.5"/>
                    </svg>
                    <span>地址</span>
                  </div>
                  {isEditing ? (
                    <input
                      type="text"
                      value={userInfo.location}
                      onChange={(e) => setUserInfo({...userInfo, location: e.target.value})}
                      className="info-input"
                    />
                  ) : (
                    <div className="info-value">{userInfo.location}</div>
                  )}
                </div>

                <div className="info-item">
                  <div className="info-label">
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                      <rect x="2" y="2" width="12" height="12" rx="2" stroke="currentColor" strokeWidth="1.5"/>
                      <path d="M2 6h12M6 2v12" stroke="currentColor" strokeWidth="1.5"/>
                    </svg>
                    <span>加入时间</span>
                  </div>
                  <div className="info-value">{userInfo.joinDate}</div>
                </div>
              </div>
            </div>

            <div className="info-card">
              <h3 className="info-title">个人简介</h3>
              {isEditing ? (
                <textarea
                  value={userInfo.bio}
                  onChange={(e) => setUserInfo({...userInfo, bio: e.target.value})}
                  className="bio-textarea"
                  rows={4}
                />
              ) : (
                <p className="bio-text">{userInfo.bio}</p>
              )}
            </div>

            <div className="info-card">
              <h3 className="info-title">技能标签</h3>
              <div className="skills-container">
                {userInfo.skills.map((skill, index) => (
                  <span key={index} className="skill-tag">
                    {skill}
                    {isEditing && (
                      <button className="skill-remove">
                        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                          <path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" strokeWidth="1.5"/>
                        </svg>
                      </button>
                    )}
                  </span>
                ))}
                {isEditing && (
                  <button className="skill-add">
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                      <path d="M6 2v8M2 6h8" stroke="currentColor" strokeWidth="1.5"/>
                    </svg>
                    添加技能
                  </button>
                )}
              </div>
            </div>
          </section>

          {isEditing && (
            <div className="action-section">
              <button className="btn-save" onClick={handleSave}>
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <path d="M13 3L6 10L3 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                </svg>
                保存修改
              </button>
            </div>
          )}
        </div>
      </main>

      <footer className="footer">
        <div className="footer-content">
          <p className="footer-text">© 2024 IAC Incubator. 保留所有权利。</p>
        </div>
      </footer>

      <style>{`
        .profile-container {
          min-height: 100vh;
          background: var(--bg-primary);
          display: flex;
          flex-direction: column;
        }

        .nav {
          position: sticky;
          top: 0;
          z-index: 100;
          background: rgba(255, 255, 255, 0.8);
          backdrop-filter: saturate(180%) blur(20px);
          border-bottom: 1px solid var(--border-light);
        }

        .nav-content {
          max-width: 1200px;
          margin: 0 auto;
          padding: 0 var(--spacing-xl);
          height: 52px;
          display: flex;
          align-items: center;
          justify-content: space-between;
        }

        .nav-back {
          display: flex;
          align-items: center;
          gap: var(--spacing-xs);
          color: var(--accent-blue);
          text-decoration: none;
          font-size: 14px;
          padding: var(--spacing-sm) var(--spacing-md);
          border-radius: var(--radius-sm);
          transition: background var(--transition-fast);
        }

        .nav-back:hover {
          background: rgba(0, 113, 227, 0.1);
          text-decoration: none;
        }

        .nav-title {
          font-size: 17px;
          font-weight: 600;
          color: var(--text-primary);
        }

        .nav-action {
          font-size: 14px;
          color: var(--accent-blue);
          background: none;
          border: none;
          padding: var(--spacing-sm) var(--spacing-md);
          border-radius: var(--radius-sm);
          cursor: pointer;
          transition: background var(--transition-fast);
        }

        .nav-action:hover {
          background: rgba(0, 113, 227, 0.1);
        }

        .main {
          flex: 1;
          padding: var(--spacing-3xl) var(--spacing-xl);
          background: var(--gradient-hero);
        }

        .main-content {
          max-width: 980px;
          margin: 0 auto;
        }

        .profile-header {
          margin-bottom: var(--spacing-2xl);
        }

        .avatar-section {
          display: flex;
          align-items: center;
          gap: var(--spacing-xl);
        }

        .avatar {
          position: relative;
          width: 120px;
          height: 120px;
        }

        .avatar-image {
          width: 100%;
          height: 100%;
          border-radius: 50%;
          object-fit: cover;
        }

        .avatar-placeholder {
          width: 100%;
          height: 100%;
          border-radius: 50%;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 48px;
          font-weight: 600;
          color: white;
        }

        .avatar-edit {
          position: absolute;
          bottom: 0;
          right: 0;
          width: 32px;
          height: 32px;
          border-radius: 50%;
          background: var(--bg-primary);
          border: 2px solid var(--border);
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          transition: all var(--transition-fast);
        }

        .avatar-edit:hover {
          background: var(--accent-blue);
          color: white;
          border-color: var(--accent-blue);
        }

        .user-basic {
          flex: 1;
        }

        .user-name {
          font-size: 32px;
          font-weight: 600;
          color: var(--text-primary);
          margin-bottom: var(--spacing-xs);
        }

        .name-input {
          font-size: 32px;
          font-weight: 600;
          color: var(--text-primary);
          background: transparent;
          border: none;
          border-bottom: 2px solid var(--accent-blue);
          padding: 0;
          width: 100%;
        }

        .name-input:focus {
          outline: none;
        }

        .user-title {
          font-size: 17px;
          color: var(--text-secondary);
        }

        .stats-section {
          margin-bottom: var(--spacing-2xl);
        }

        .stats-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
          gap: var(--spacing-md);
        }

        .stat-card {
          background: var(--bg-primary);
          padding: var(--spacing-xl);
          border-radius: 8px;
          text-align: center;
          box-shadow: var(--shadow-sm);
          border: 1px solid var(--border-light);
          transition: all var(--transition-base);
        }

        .stat-card:hover {
          transform: translateY(-2px);
          box-shadow: var(--shadow-md);
        }

        .stat-value {
          font-size: 32px;
          font-weight: 600;
          color: var(--accent-blue);
          margin-bottom: var(--spacing-xs);
        }

        .stat-label {
          font-size: 15px;
          color: var(--text-secondary);
        }

        .info-section {
          display: flex;
          flex-direction: column;
          gap: var(--spacing-xl);
        }

        .info-card {
          background: var(--bg-primary);
          padding: var(--spacing-2xl);
          border-radius: 8px;
          box-shadow: var(--shadow-sm);
          border: 1px solid var(--border-light);
        }

        .info-title {
          font-size: 21px;
          font-weight: 600;
          color: var(--text-primary);
          margin-bottom: var(--spacing-xl);
        }

        .info-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
          gap: var(--spacing-xl);
        }

        .info-item {
          display: flex;
          flex-direction: column;
          gap: var(--spacing-sm);
        }

        .info-label {
          display: flex;
          align-items: center;
          gap: var(--spacing-sm);
          font-size: 13px;
          color: var(--text-secondary);
        }

        .info-value {
          font-size: 17px;
          color: var(--text-primary);
        }

        .info-input {
          font-size: 17px;
          color: var(--text-primary);
          background: var(--bg-secondary);
          border: 1px solid var(--border);
          border-radius: 8px;
          padding: 8px 12px;
          transition: all var(--transition-fast);
        }

        .info-input:focus {
          outline: none;
          border-color: var(--accent-blue);
          box-shadow: 0 0 0 3px rgba(0, 113, 227, 0.1);
        }

        .bio-text {
          font-size: 17px;
          line-height: 1.6;
          color: var(--text-primary);
        }

        .bio-textarea {
          font-size: 17px;
          line-height: 1.6;
          color: var(--text-primary);
          background: var(--bg-secondary);
          border: 1px solid var(--border);
          border-radius: 8px;
          padding: 12px;
          width: 100%;
          resize: vertical;
          font-family: inherit;
        }

        .bio-textarea:focus {
          outline: none;
          border-color: var(--accent-blue);
          box-shadow: 0 0 0 3px rgba(0, 113, 227, 0.1);
        }

        .skills-container {
          display: flex;
          flex-wrap: wrap;
          gap: var(--spacing-sm);
        }

        .skill-tag {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 6px 12px;
          background: rgba(0, 113, 227, 0.1);
          color: var(--accent-blue);
          border-radius: 16px;
          font-size: 14px;
          font-weight: 500;
        }

        .skill-remove {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 16px;
          height: 16px;
          border-radius: 50%;
          background: transparent;
          border: none;
          color: var(--accent-blue);
          cursor: pointer;
          padding: 0;
          transition: all var(--transition-fast);
        }

        .skill-remove:hover {
          background: var(--accent-blue);
          color: white;
        }

        .skill-add {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 6px 12px;
          background: transparent;
          color: var(--text-secondary);
          border: 1px dashed var(--border);
          border-radius: 16px;
          font-size: 14px;
          cursor: pointer;
          transition: all var(--transition-fast);
        }

        .skill-add:hover {
          border-color: var(--accent-blue);
          color: var(--accent-blue);
        }

        .action-section {
          margin-top: var(--spacing-2xl);
          display: flex;
          justify-content: center;
        }

        .btn-save {
          display: inline-flex;
          align-items: center;
          gap: var(--spacing-sm);
          padding: 12px 32px;
          background: var(--accent-blue);
          color: white;
          border: none;
          border-radius: 8px;
          font-size: 16px;
          font-weight: 500;
          cursor: pointer;
          transition: all var(--transition-fast);
        }

        .btn-save:hover {
          background: #005fcc;
          transform: translateY(-1px);
          box-shadow: 0 4px 12px rgba(0, 113, 227, 0.3);
        }

        .footer {
          background: var(--bg-primary);
          border-top: 1px solid var(--border-light);
          padding: var(--spacing-xl);
        }

        .footer-content {
          max-width: 1200px;
          margin: 0 auto;
          text-align: center;
        }

        .footer-text {
          font-size: 13px;
          color: var(--text-secondary);
        }
      `}</style>
    </div>
  );
};

export default Profile;
