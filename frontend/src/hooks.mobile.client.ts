import type { HandleClientError } from '@sveltejs/kit/hooks';

export const handleError: HandleClientError = () => ({
  message: '页面加载失败，请重试',
});
