import { Badge, Tooltip } from 'antd';
import { useRealtime } from './useRealtimeEvent';
export function ConnectionStatus() {
  const { status } = useRealtime();
  const text = {
    connecting: '连接中',
    connected: '已连接',
    disconnected: '中断',
  }[status];
  return (
    <Tooltip
      title={
        status === 'disconnected'
          ? '实时连接中断，可手动刷新；恢复后自动获取最新数据'
          : '商品、分类与自己的订单实时通知'
      }
    >
      <span
        className="realtime-status"
        role="status"
        aria-label={'实时连接：' + text}
      >
        <Badge
          status={
            status === 'connected'
              ? 'success'
              : status === 'connecting'
                ? 'processing'
                : 'warning'
          }
          text={text}
        />
      </span>
    </Tooltip>
  );
}
