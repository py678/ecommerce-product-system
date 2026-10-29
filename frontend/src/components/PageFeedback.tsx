import { Alert, Button, Spin } from 'antd';

export function LoadingScreen() {
  return (
    <div className="loading-screen" role="status" aria-label="正在加载">
      <Spin size="large" />
    </div>
  );
}

export function RequestError({
  error,
  retry,
}: {
  error: string;
  retry: () => void;
}) {
  return (
    <Alert
      className="request-error"
      type="error"
      showIcon
      title="加载未完成"
      description={error}
      action={<Button onClick={retry}>重试</Button>}
    />
  );
}
