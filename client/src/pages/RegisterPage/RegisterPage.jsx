import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Card, Form, Input, Button, Typography, message } from 'antd';
import { UserOutlined, LockOutlined, MailOutlined } from '@ant-design/icons';
import { Capacitor } from '@capacitor/core';
import api from '../../services/api';
import MobileAuthLayout from '../../components/MobileAuthLayout';

const { Title, Text } = Typography;

const isNative = Capacitor.isNativePlatform();

function RegisterPage() {
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const onFinish = async (values) => {
    if (loading) return; // 防止重复提交
    setLoading(true);
    try {
      const { username, email, password } = values;
      const { data } = await api.post('/api/auth/register', { username, email, password });
      if (data.success) {
        localStorage.setItem('token', data.data.token);
        localStorage.setItem('username', data.data.username);
        localStorage.setItem('has_seen_tour', '0');
        message.success(data.message);
        navigate('/', { replace: true });
      } else {
        message.error(data.message);
      }
    } catch (err) {
      const msg = err.response?.data?.message || '注册失败，请重试';
      message.error(msg);
    } finally {
      setLoading(false);
    }
  };

  const form = (
    <Form name="register" onFinish={onFinish} size="large" autoComplete="off">
      <Form.Item
        name="username"
        rules={[
          { required: true, message: '请输入用户名' },
          { min: 2, message: '用户名至少2个字符' },
        ]}
      >
        <Input prefix={<UserOutlined />} placeholder="用户名" className="!h-12" />
      </Form.Item>

      <Form.Item
        name="email"
        rules={[
          { required: true, message: '请输入邮箱' },
          { type: 'email', message: '邮箱格式不正确' },
        ]}
      >
        <Input prefix={<MailOutlined />} placeholder="邮箱（用于接收提醒邮件）" className="!h-12" />
      </Form.Item>

      <Form.Item
        name="password"
        rules={[
          { required: true, message: '请输入密码' },
          { min: 6, message: '密码至少6位' },
        ]}
        extra={<span className="text-[11px] text-slate-400">密码至少 6 位</span>}
      >
        <Input.Password prefix={<LockOutlined />} placeholder="密码" className="!h-12" />
      </Form.Item>

      <Form.Item
        name="confirm"
        dependencies={['password']}
        rules={[
          { required: true, message: '请确认密码' },
          ({ getFieldValue }) => ({
            validator(_, value) {
              if (!value || getFieldValue('password') === value) return Promise.resolve();
              return Promise.reject(new Error('两次输入的密码不一致'));
            },
          }),
        ]}
      >
        <Input.Password prefix={<LockOutlined />} placeholder="确认密码" className="!h-12" />
      </Form.Item>

      <Form.Item className="!mb-3">
        <Text className="!text-xs !text-slate-400">
          注册即表示：事件提醒邮件将发送至您的注册邮箱
        </Text>
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
          创建账户
        </Button>
      </Form.Item>
    </Form>
  );

  // ---- 原生 App：全屏表单，纵向可滚动，键盘不遮挡当前输入框 ----
  if (isNative) {
    return (
      <MobileAuthLayout>
        <div className="text-center">
          <div className="w-12 h-12 rounded-xl bg-slate-900 text-white flex items-center justify-center
            font-bold mx-auto">
            TM
          </div>
          <h1 className="text-xl font-semibold text-slate-900 mt-4">TalentMate 伴贤</h1>
          <p className="text-xs text-slate-400 mt-1.5">创建你的私人关系库</p>
        </div>

        <div className="mt-6">{form}</div>

        <div className="text-center mt-1">
          <Text type="secondary" className="!text-xs">
            已有账户？ <Link to="/login">立即登录</Link>
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
        style={{ width: 440 }}
        bordered={false}
        bodyStyle={{ padding: '36px 36px 28px' }}
      >
        <div className="flex items-center justify-center mb-3">
          <span className="w-11 h-11 rounded-xl bg-slate-900 text-white flex items-center justify-center font-bold">TM</span>
        </div>
        <Title level={3} className="!text-center !mb-1 !text-slate-900">
          TalentMate 伴贤
        </Title>
        <Text className="block text-center mb-5 text-slate-400">
          创建你的私人关系库
        </Text>

        {form}

        <div className="text-center">
          <Text type="secondary">
            已有账户？ <Link to="/login">立即登录</Link>
          </Text>
        </div>
      </Card>
    </div>
  );
}

export default RegisterPage;
