import { useEffect, useState } from "react";
import {
  Alert,
  Button,
  Drawer,
  Form,
  Input,
  Select,
  Tabs,
  message,
} from "antd";
import { runtimeConfigApi, botsApi } from "../api";
import { useAuth } from "../lib/auth";

export default function SecureSetup({ onClose }: { onClose: () => void }) {
  const { user, currentOrg, currentOrgId } = useAuth();
  const [form] = Form.useForm();
  const [botForm] = Form.useForm();
  const [saving, setSaving] = useState(false);
  const [bots, setBots] = useState<any[]>([]);
  const [botId, setBotId] = useState<number | undefined>();
  const [error, setError] = useState("");
  const canManage =
    user?.is_system_admin ||
    ["owner", "admin"].includes(currentOrg?.my_role || currentOrg?.role || "");
  useEffect(() => {
    if (user?.is_system_admin)
      runtimeConfigApi
        .get()
        .then((r) => {
          const fields = Object.fromEntries(
            Object.entries(r.values || {})
              .filter(([, v]: any) => !v.secret)
              .map(([k, v]: any) => [k, v.value]),
          );
          form.setFieldsValue(fields);
        })
        .catch(() => setError("读取连接配置失败，请重试。"));
    if (canManage && currentOrgId)
      botsApi
        .list(currentOrgId)
        .then((r) => setBots(r.items || []))
        .catch(() => setError("读取通知连接失败。"));
  }, [currentOrgId]);
  const saveModel = async (values: Record<string, string>) => {
    setSaving(true);
    setError("");
    try {
      await runtimeConfigApi.update(
        Object.fromEntries(Object.entries(values).filter(([, v]) => v?.trim())),
      );
      form.setFieldsValue({ AI_API_KEY: "", TAVILY_API_KEY: "" });
      message.success("连接已保存，可返回对话继续任务");
    } catch {
      setError("保存失败，请检查地址、字段和权限。");
    } finally {
      setSaving(false);
    }
  };
  const saveBot = async (values: any) => {
    setSaving(true);
    setError("");
    try {
      const data = { ...values, orgId: currentOrgId };
      if (botId) await botsApi.update(botId, data);
      else await botsApi.create(data);
      botForm.resetFields();
      setBotId(undefined);
      const r = await botsApi.list(currentOrgId!);
      setBots(r.items || []);
      message.success("通知连接已保存");
    } catch {
      setError("保存失败，请检查官方飞书 Webhook 地址及组织权限。");
    } finally {
      setSaving(false);
    }
  };
  return (
    <Drawer title="连接配置" open onClose={onClose} width={480}>
      <p>凭据直接保存到服务端，不会进入对话、模型上下文或执行轨迹。</p>
      {error && <Alert type="error" message={error} showIcon />}
      <Tabs
        items={[
          ...(user?.is_system_admin
            ? [
                {
                  key: "model",
                  label: "模型与搜索",
                  children: (
                    <Form form={form} layout="vertical" onFinish={saveModel}>
                      <Form.Item label="连接名称" name="AI_PROVIDER_NAME">
                        <Input placeholder="我的模型服务" />
                      </Form.Item>
                      <Form.Item label="API 地址" name="AI_BASE_URL">
                        <Input placeholder="https://…/v1" />
                      </Form.Item>
                      <Form.Item label="模型名称" name="AI_MODEL">
                        <Input placeholder="支持工具调用的模型" />
                      </Form.Item>
                      <Form.Item label="模型 API Key" name="AI_API_KEY">
                        <Input.Password
                          autoComplete="new-password"
                          placeholder="留空保留现有密钥"
                        />
                      </Form.Item>
                      <Form.Item label="Tavily API Key" name="TAVILY_API_KEY">
                        <Input.Password
                          autoComplete="new-password"
                          placeholder="留空保留现有密钥"
                        />
                      </Form.Item>
                      <Button htmlType="submit" type="primary" loading={saving}>
                        保存连接
                      </Button>
                    </Form>
                  ),
                },
              ]
            : []),
          ...(canManage
            ? [
                {
                  key: "bots",
                  label: "飞书通知",
                  children: (
                    <>
                      <Select
                        aria-label="编辑通知连接"
                        placeholder="新增通知连接"
                        allowClear
                        value={botId}
                        style={{ width: "100%", marginBottom: 20 }}
                        options={bots.map((b) => ({
                          value: b.id,
                          label: b.name,
                        }))}
                        onChange={(id) => {
                          setBotId(id);
                          botForm.resetFields();
                          botForm.setFieldsValue({
                            name: bots.find((b) => b.id === id)?.name,
                          });
                        }}
                      />
                      <Form form={botForm} layout="vertical" onFinish={saveBot}>
                        <Form.Item
                          label="名称"
                          name="name"
                          rules={[{ required: true }]}
                        >
                          <Input />
                        </Form.Item>
                        <Form.Item
                          label="飞书 Webhook"
                          name="webhook_url"
                          rules={[{ required: !botId }]}
                        >
                          <Input.Password
                            placeholder={
                              botId
                                ? "留空保留现有地址"
                                : "https://open.feishu.cn/open-apis/bot/v2/hook/…"
                            }
                            autoComplete="new-password"
                          />
                        </Form.Item>
                        <Form.Item label="签名密钥（可选）" name="secret">
                          <Input.Password autoComplete="new-password" />
                        </Form.Item>
                        <Button
                          htmlType="submit"
                          type="primary"
                          loading={saving}
                        >
                          保存通知连接
                        </Button>
                      </Form>
                      <p style={{ marginTop: 20 }}>
                        保存后，可以在对话中设置通知规则。发送通知需要管理员审批。
                      </p>
                    </>
                  ),
                },
              ]
            : []),
        ]}
      />
      {!canManage && (
        <Alert
          type="info"
          message="请联系组织管理员配置通知连接，联系系统管理员配置模型。"
        />
      )}
    </Drawer>
  );
}
