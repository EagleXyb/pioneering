// 个人中心页（TDesign 重构版）

import React, { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import {
  Card,
  Avatar,
  Button,
  Input,
  Textarea,
  Tag,
  Loading,
  Space,
  Row,
  Col,
  MessagePlugin,
} from 'tdesign-react';
import {
  ArrowLeftIcon,
  EditIcon,
  SaveIcon,
  CloseIcon,
  AddIcon,
  MailIcon,
  CallIcon,
  LocationIcon,
  TimeIcon,
  UserIcon,
  HomeIcon,
} from 'tdesign-icons-react';
import { useUser } from '../contexts/UserContext';
import type { ProfileData } from '@shared/types/profile';
import { DEFAULT_PROFILE } from '@shared/constants';
import { API_ENDPOINTS } from '@shared/api/endpoints';

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000';
const defaultProfile: ProfileData = DEFAULT_PROFILE;

const Profile: React.FC = () => {
  const { userState, setAvatar, setName, getToken } = useUser();
  const [isEditing, setIsEditing] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [userInfo, setUserInfo] = useState<ProfileData>(defaultProfile);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (userState.isLoggedIn) {
      fetchProfile();
    } else {
      setIsLoading(false);
    }
  }, [userState.isLoggedIn]);

  const fetchProfile = async () => {
    try {
      setIsLoading(true);
      const token = getToken();
      const response = await fetch(`${API_BASE}${API_ENDPOINTS.PROFILE.BASE}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (response.ok) {
        const data = await response.json();
        if (data) {
          setUserInfo(prev => ({
            ...prev,
            ...data,
            joinDate: data.createdAt
              ? new Date(data.createdAt).toISOString().split('T')[0]
              : prev.joinDate,
            name: data.nickname || data.username || prev.name,
            email: data.email || prev.email,
            phone: data.phone || prev.phone,
          }));
          if (data.avatar) setAvatar(data.avatar);
          if (data.nickname) setName(data.nickname);
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
      const token = getToken();
      if (!token) {
        MessagePlugin.error('请先登录再保存个人信息');
        return;
      }
      setIsSaving(true);
      const response = await fetch(`${API_BASE}${API_ENDPOINTS.PROFILE.BASE}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          nickname: userInfo.name,
          avatar: userInfo.avatar,
        }),
      });
      if (response.ok) {
        setIsEditing(false);
        setName(userInfo.name);
        MessagePlugin.success('保存成功');
        await fetchProfile();
      } else {
        console.error('保存失败:', response.status);
        MessagePlugin.error('保存失败，请重试');
      }
    } catch (err) {
      console.error('保存个人信息失败:', err);
      MessagePlugin.error('保存失败，请检查网络连接');
    } finally {
      setIsSaving(false);
    }
  };

  const handleAvatarClick = () => {
    if (isEditing) fileInputRef.current?.click();
  };

  const handleAvatarChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      MessagePlugin.warning('请选择图片文件');
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      MessagePlugin.warning('图片大小不能超过 10MB');
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const base64 = reader.result as string;
      setAvatar(base64);
      setUserInfo(prev => ({ ...prev, avatar: base64 }));
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const handleRemoveSkill = (index: number) => {
    setUserInfo(prev => ({
      ...prev,
      skills: prev.skills.filter((_, i) => i !== index),
    }));
  };

  const handleAddSkill = () => {
    const newSkill = window.prompt('请输入新技能：');
    if (newSkill?.trim()) {
      setUserInfo(prev => ({
        ...prev,
        skills: [...prev.skills, newSkill.trim()],
      }));
    }
  };

  // ==================== 未登录状态 ====================
  if (!userState.isLoggedIn && !isLoading) {
    return (
      <div style={containerStyle}>
        <div style={navStyle}>
          <div style={navContentStyle}>
            <Link to="/" style={navBackStyle}>
              <ArrowLeftIcon size="20px" />
              <span>返回首页</span>
            </Link>
            <span style={navTitleStyle}>个人中心</span>
          </div>
        </div>
        <div style={emptyStateStyle}>
          <UserIcon size="64px" style={{ color: 'var(--td-text-color-placeholder)' }} />
          <p style={{ marginTop: 16, color: 'var(--td-text-color-secondary)', fontSize: 16 }}>
            请先登录后查看个人信息
          </p>
          <Link to="/">
            <Button theme="primary" style={{ marginTop: 16 }}>返回首页登录</Button>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div style={containerStyle}>
      {/* 顶部导航 */}
      <div style={navStyle}>
        <div style={navContentStyle}>
          <Link to="/" style={navBackStyle}>
            <ArrowLeftIcon size="20px" />
            <span>返回首页</span>
          </Link>
          <span style={navTitleStyle}>个人中心</span>
          <Button
            variant="text"
            theme="primary"
            icon={isEditing ? <CloseIcon /> : <EditIcon />}
            onClick={() => setIsEditing(!isEditing)}
          >
            {isEditing ? '取消' : '编辑'}
          </Button>
        </div>
      </div>

      {/* 主内容区域 */}
      <div style={mainStyle}>
        <div style={mainContentStyle}>
          <Loading loading={isLoading} size="large">
            {/* 用户头部信息 */}
            <Card bordered style={{ marginBottom: 24 }}>
              <Space direction="horizontal" size={24} align="center">
                <div
                  onClick={handleAvatarClick}
                  style={{ cursor: isEditing ? 'pointer' : 'default', position: 'relative' }}
                >
                  <Avatar
                    size="120px"
                    image={userState.avatar || undefined}
                    shape="circle"
                  >
                    {!userState.avatar && userInfo.name.charAt(0)}
                  </Avatar>
                  {isEditing && (
                    <div style={avatarEditOverlayStyle}>
                      <EditIcon size="16px" />
                    </div>
                  )}
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    onChange={handleAvatarChange}
                    style={{ display: 'none' }}
                  />
                </div>
                <div style={{ flex: 1 }}>
                  {isEditing ? (
                    <Input
                      value={userInfo.name}
                      onChange={(val) => setUserInfo({ ...userInfo, name: val as string })}
                      size="large"
                      style={{ fontSize: 24, fontWeight: 600 }}
                      placeholder="输入姓名"
                    />
                  ) : (
                    <h2 style={{ fontSize: 28, fontWeight: 600, margin: 0 }}>
                      {userInfo.name}
                    </h2>
                  )}
                  <p style={{ color: 'var(--td-text-color-secondary)', marginTop: 4, marginBottom: 0 }}>
                    {userInfo.position} · {userInfo.company}
                  </p>
                </div>
              </Space>
            </Card>

            {/* 数据统计 */}
            <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
              {userInfo.achievements.map((stat, index) => (
                <Col key={index} xs={6} sm={6} md={3}>
                  <Card bordered style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: 28, fontWeight: 600, color: 'var(--td-brand-color)' }}>
                      {stat.value}
                    </div>
                    <div style={{ color: 'var(--td-text-color-secondary)', marginTop: 4 }}>
                      {stat.label}
                    </div>
                  </Card>
                </Col>
              ))}
            </Row>

            {/* 基本信息 */}
            <Card
              bordered
              title="基本信息"
              headerBordered
              style={{ marginBottom: 16 }}
            >
              <Row gutter={[24, 16]}>
                <Col xs={12} md={6}>
                  <div style={infoFieldStyle}>
                    <div style={infoLabelStyle}>
                      <MailIcon size="16px" />
                      <span>邮箱</span>
                    </div>
                    {isEditing ? (
                      <Input
                        value={userInfo.email}
                        onChange={(val) => setUserInfo({ ...userInfo, email: val as string })}
                        placeholder="请输入邮箱"
                      />
                    ) : (
                      <div style={infoValueStyle}>{userInfo.email}</div>
                    )}
                  </div>
                </Col>
                <Col xs={12} md={6}>
                  <div style={infoFieldStyle}>
                    <div style={infoLabelStyle}>
                      <CallIcon size="16px" />
                      <span>电话</span>
                    </div>
                    {isEditing ? (
                      <Input
                        value={userInfo.phone}
                        onChange={(val) => setUserInfo({ ...userInfo, phone: val as string })}
                        placeholder="请输入电话"
                      />
                    ) : (
                      <div style={infoValueStyle}>{userInfo.phone}</div>
                    )}
                  </div>
                </Col>
                <Col xs={12} md={6}>
                  <div style={infoFieldStyle}>
                    <div style={infoLabelStyle}>
                      <LocationIcon size="16px" />
                      <span>地址</span>
                    </div>
                    {isEditing ? (
                      <Input
                        value={userInfo.location}
                        onChange={(val) => setUserInfo({ ...userInfo, location: val as string })}
                        placeholder="请输入地址"
                      />
                    ) : (
                      <div style={infoValueStyle}>{userInfo.location}</div>
                    )}
                  </div>
                </Col>
                <Col xs={12} md={6}>
                  <div style={infoFieldStyle}>
                    <div style={infoLabelStyle}>
                      <TimeIcon size="16px" />
                      <span>加入时间</span>
                    </div>
                    <div style={infoValueStyle}>{userInfo.joinDate}</div>
                  </div>
                </Col>
              </Row>
            </Card>

            {/* 个人简介 */}
            <Card bordered title="个人简介" headerBordered style={{ marginBottom: 16 }}>
              {isEditing ? (
                <Textarea
                  value={userInfo.bio}
                  onChange={(val) => setUserInfo({ ...userInfo, bio: val as string })}
                  placeholder="介绍一下自己..."
                  autosize={{ minRows: 3, maxRows: 6 }}
                />
              ) : (
                <p style={{ margin: 0, lineHeight: 1.8, color: 'var(--td-text-color-primary)' }}>
                  {userInfo.bio}
                </p>
              )}
            </Card>

            {/* 技能标签 */}
            <Card bordered title="技能标签" headerBordered style={{ marginBottom: 16 }}>
              <Space direction="horizontal" size={8} style={{ flexWrap: 'wrap' }}>
                {userInfo.skills.map((skill, index) => (
                  <Tag
                    key={index}
                    theme="primary"
                    variant="light"
                    closable={isEditing}
                    onClose={() => handleRemoveSkill(index)}
                    style={{ padding: '4px 12px' }}
                  >
                    {skill}
                  </Tag>
                ))}
                {isEditing && (
                  <Tag
                    theme="default"
                    variant="outline"
                    icon={<AddIcon />}
                    onClick={handleAddSkill}
                    style={{ cursor: 'pointer', padding: '4px 12px' }}
                  >
                    添加技能
                  </Tag>
                )}
              </Space>
            </Card>

            {/* 保存按钮 */}
            {isEditing && (
              <div style={{ marginTop: 24, display: 'flex', justifyContent: 'center' }}>
                <Space size={16}>
                  <Button
                    variant="outline"
                    icon={<CloseIcon />}
                    onClick={() => setIsEditing(false)}
                  >
                    取消
                  </Button>
                  <Button
                    theme="primary"
                    icon={<SaveIcon />}
                    onClick={handleSave}
                    loading={isSaving}
                  >
                    保存修改
                  </Button>
                </Space>
              </div>
            )}
          </Loading>
        </div>
      </div>

      {/* 页脚 */}
      <footer style={footerStyle}>
        <div style={{ textAlign: 'center', color: 'var(--td-text-color-placeholder)', fontSize: 14 }}>
          © 2024 IAC Incubator. 保留所有权利。
        </div>
      </footer>
    </div>
  );
};

// ==================== 样式常量 ====================

const containerStyle: React.CSSProperties = {
  minHeight: '100vh',
  display: 'flex',
  flexDirection: 'column',
  background: 'var(--td-bg-color-page)',
};

const navStyle: React.CSSProperties = {
  position: 'sticky',
  top: 0,
  zIndex: 100,
  background: 'rgba(255, 255, 255, 0.85)',
  backdropFilter: 'saturate(180%) blur(20px)',
  borderBottom: '1px solid var(--td-component-border)',
};

const navContentStyle: React.CSSProperties = {
  maxWidth: 1100,
  margin: '0 auto',
  padding: '0 24px',
  height: 56,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
};

const navBackStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  color: 'var(--td-brand-color)',
  textDecoration: 'none',
  fontSize: 14,
};

const navTitleStyle: React.CSSProperties = {
  fontSize: 17,
  fontWeight: 600,
  color: 'var(--td-text-color-primary)',
};

const mainStyle: React.CSSProperties = {
  flex: 1,
  padding: '32px 24px',
};

const mainContentStyle: React.CSSProperties = {
  maxWidth: 900,
  margin: '0 auto',
};

const emptyStateStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  flex: 1,
  padding: '80px 24px',
};

const avatarEditOverlayStyle: React.CSSProperties = {
  position: 'absolute',
  bottom: 0,
  right: 0,
  width: 32,
  height: 32,
  borderRadius: '50%',
  background: 'var(--td-bg-color-container)',
  border: '2px solid var(--td-component-border)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  cursor: 'pointer',
  color: 'var(--td-brand-color)',
};

const infoFieldStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
};

const infoLabelStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  fontSize: 13,
  color: 'var(--td-text-color-secondary)',
};

const infoValueStyle: React.CSSProperties = {
  fontSize: 15,
  color: 'var(--td-text-color-primary)',
  minHeight: 32,
  display: 'flex',
  alignItems: 'center',
};

const footerStyle: React.CSSProperties = {
  borderTop: '1px solid var(--td-component-border)',
  padding: '24px',
};

export default Profile;