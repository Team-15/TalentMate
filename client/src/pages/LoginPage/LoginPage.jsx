import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Card, Form, Input, Button, Typography, message } from 'antd';
import { UserOutlined, LockOutlined } from '@ant-design/icons';
import { Capacitor } from '@capacitor/core';
import api from '../../services/api';
import MobileAuthLayout from '../../components/MobileAuthLayout';

const { Title, Text } = Typography;

const isNative = Capacitor.isNativePlatform();

function LoginPage() {
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const onFinish = async (values) => {
    if (loading) return; // 防止重复提交
    setLoading(true);
    try {
      const { data } = await api.post('/api/auth/login', values);
      if (data.success) {
        localStorage.setItem('token', data.data.token);
        localStorage.setItem('username', data.data.username);
        if (data.data.has_seen_tour) localStorage.setItem('has_seen_tour', '1');
        message.success(data.message);
        navigate('/', { replace: true });
      } else {
        message.error(data.message);
      }
    } catch (err) {
      const msg = err.response?.data?.message || '登录失败，请重试';
      message.error(msg);
    } finally {
      setLoading(false);
    }
  };

  const form = (
    <Form name="login" onFinish={onFinish} size="large" autoComplete="off">
      <Form.Item name="username" rules={[{ required: true, message: '请输入用户名' }]}>
        <Input prefix={<UserOutlined />} placeholder="用户名" className="!h-12" />
      </Form.Item>
      <Form.Item name="password" rules={[{ required: true, message: '请输入密码' }]}>
        <Input.Password prefix={<LockOutlined />} placeholder="密码" className="!h-12" />
      </Form.Item>
      <Form.Item className="!mb-3">
        <Button
          type="primary"
          htmlType="submit"
          loading={loading}
          disabled={loading}
          block
          className="!h-12"
        >
          开始使用
        </Button>
      </Form.Item>
    </Form>
  );

  // ---- 原生 App：全屏表单，避免固定宽度 Card 在窄屏被裁切 ----
  if (isNative) {
    return (
      <MobileAuthLayout>
        <div className="pt-6 pb-2 text-center">
          <div className="w-14 h-14 rounded-2xl bg-slate-900 text-white flex items-center justify-center
            font-bold text-xl mx-auto">
            TM
          </div>
          <h1 className="text-xl font-semibold text-slate-900 mt-4">TalentMate 伴贤</h1>
          <p className="text-xs text-slate-400 mt-1.5">语音驱动的私人关系关怀助手</p>
        </div>

        <div className="mt-8">{form}</div>

        <div className="text-center mt-2">
          <Text type="secondary" className="!text-xs">
            还没有账户？ <Link to="/register">立即注册</Link>
          </Text>
        </div>
      </MobileAuthLayout>
    );
  }

  // ---- 浏览器：保留原有桌面 Card ----
  return (
    <div className="min-h-screen flex items-center justify-center bg-[#EEF3F8] px-4">
      <Card
        className="!rounded-2xl !shadow-[0_20px_70px_rgba(15,23,42,0.10)] !border !border-white/80"
        style={{ width: 420 }}
        bordered={false}
        bodyStyle={{ padding: '40px 36px' }}
      >
        <div className="flex items-center justify-center mb-4">
          <span className="w-12 h-12 rounded-xl bg-slate-900 text-white flex items-center justify-center font-bold text-lg">TM</span>
        </div>
        <Title level={3} className="!text-center !mb-1 !text-slate-900">
          TalentMate 伴贤
        </Title>
        <Text className="block text-center mb-6 text-slate-400">
          登录私人关系关怀工作台
        </Text>

        {form}

        <div className="text-center">
          <Text type="secondary">
            还没有账户？ <Link to="/register">立即注册</Link>
          </Text>
        </div>
      </Card>
    </div>
  );
}

export default LoginPage;
