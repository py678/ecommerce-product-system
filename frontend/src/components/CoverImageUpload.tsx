import { useEffect, useRef, useState } from 'react';
import { LoadingOutlined, PlusOutlined } from '@ant-design/icons';
import { App, Modal, Upload } from 'antd';
import type { UploadProps } from 'antd';
import { api, errorMessage, isCanceled } from '../api/client';

const MAX_BYTES = 5 * 1024 * 1024;

export function CoverImageUpload({
  value = '',
  onChange,
  disabled = false,
  onUploadingChange,
}: {
  value?: string;
  onChange?: (value: string) => void;
  disabled?: boolean;
  onUploadingChange: (uploading: boolean) => void;
}) {
  const { message } = App.useApp();
  const [uploading, setUploading] = useState(false);
  const [preview, setPreview] = useState(false);
  const activeRequest = useRef<AbortController | null>(null);
  useEffect(() => () => activeRequest.current?.abort(), []);

  const beforeUpload: UploadProps['beforeUpload'] = (file) => {
    if (
      !/\.(jpe?g|png|webp)$/i.test(file.name) ||
      !['image/jpeg', 'image/png', 'image/webp'].includes(file.type)
    ) {
      void message.error('仅支持 JPG、JPEG、PNG、WEBP 图片');
      return Upload.LIST_IGNORE;
    }
    if (file.size > MAX_BYTES) {
      void message.error('图片不能超过 5MB');
      return Upload.LIST_IGNORE;
    }
    return true;
  };

  const upload: UploadProps['customRequest'] = (options) => {
    const controller = new AbortController();
    activeRequest.current = controller;
    setUploading(true);
    onUploadingChange(true);
    void api.upload
      .image(options.file as File, controller.signal)
      .then((response) => {
        if (controller.signal.aborted) return;
        onChange?.(response.data.url);
        options.onSuccess?.(response);
      })
      .catch((cause: unknown) => {
        if (isCanceled(cause)) return;
        const text = errorMessage(cause);
        void message.error(text);
        options.onError?.(new Error(text));
      })
      .finally(() => {
        if (controller.signal.aborted) return;
        activeRequest.current = null;
        setUploading(false);
        onUploadingChange(false);
      });
    return { abort: () => controller.abort() };
  };

  return (
    <>
      <Upload
        accept=".jpg,.jpeg,.png,.webp"
        listType="picture-card"
        maxCount={1}
        disabled={disabled || uploading}
        beforeUpload={beforeUpload}
        customRequest={upload}
        fileList={
          value
            ? [{ uid: value, name: '商品封面', status: 'done', url: value }]
            : []
        }
        onPreview={() => setPreview(true)}
        onRemove={() => {
          onChange?.('');
          return true;
        }}
      >
        {!value && (
          <button
            type="button"
            disabled={disabled || uploading}
            style={{ border: 0, background: 'none', cursor: 'pointer' }}
          >
            {uploading ? <LoadingOutlined /> : <PlusOutlined />}
            <div>{uploading ? '上传中…' : '上传封面'}</div>
          </button>
        )}
      </Upload>
      <Modal
        open={preview}
        title="商品封面"
        footer={null}
        onCancel={() => setPreview(false)}
      >
        <img src={value} alt="商品封面预览" style={{ width: '100%' }} />
      </Modal>
    </>
  );
}
