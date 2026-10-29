import { useEffect, useRef, useState } from 'react';
import { Select, Spin } from 'antd';
import { api, errorMessage, isCanceled } from '../api/client';
import type { Category } from '../api/types';

interface Props {
  value?: string;
  onChange?: (value?: string) => void;
  initialOption?: { id: string; name: string };
  allowClear?: boolean;
  placeholder?: string;
  id?: string;
}

export function CategorySelect({
  value,
  onChange,
  initialOption,
  allowClear,
  placeholder = '选择分类',
  id,
}: Props) {
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<Category[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cache = useRef(new Map<string, { id: string; name: string }>());

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setQuery(search.trim());
      setPage(1);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    api.categories
      .list(
        { page, pageSize: 100, search: query || undefined },
        controller.signal,
      )
      .then((result) => {
        if (controller.signal.aborted) return;
        result.items.forEach((item) => cache.current.set(item.id, item));
        setItems((previous) =>
          page === 1
            ? result.items
            : [
                ...new Map(
                  [...previous, ...result.items].map((item) => [item.id, item]),
                ).values(),
              ],
        );
        setHasMore(page < result.totalPages);
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted && !isCanceled(cause))
          setError(errorMessage(cause));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [page, query]);

  const selected = value
    ? (cache.current.get(value) ??
      (initialOption?.id === value ? initialOption : undefined))
    : undefined;
  const options = items.map((item) => ({ value: item.id, label: item.name }));
  if (selected && !options.some((option) => option.value === selected.id))
    options.unshift({ value: selected.id, label: selected.name });

  return (
    <Select
      id={id}
      aria-label={placeholder}
      value={value}
      onChange={onChange}
      allowClear={allowClear}
      placeholder={placeholder}
      showSearch={{ filterOption: false, onSearch: setSearch }}
      options={options}
      loading={loading}
      notFoundContent={
        loading ? (
          <Spin size="small" />
        ) : (
          (error ?? '暂无分类，请先在分类管理中创建')
        )
      }
      onPopupScroll={(event) => {
        const target = event.currentTarget;
        if (
          !loading &&
          hasMore &&
          target.scrollTop + target.clientHeight >= target.scrollHeight - 24
        )
          setPage((current) => current + 1);
      }}
    />
  );
}
