export const reportEvent = type => {
  if (process.env.NODE_ENV !== 'production') {
    return;
  }

  const payload = JSON.stringify({ type });
  if (navigator.sendBeacon) {
    navigator.sendBeacon('/telemetry/events', new Blob([payload], { type: 'application/json' }));
    return;
  }
  fetch('/telemetry/events', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: payload,
    keepalive: true,
  }).catch(() => {});
};

export const installErrorReporting = () => {
  if (process.env.NODE_ENV !== 'production') {
    return () => {};
  }

  const onError = () => reportEvent('frontend_error');
  const onRejection = () => reportEvent('frontend_error');
  window.addEventListener('error', onError);
  window.addEventListener('unhandledrejection', onRejection);
  return () => {
    window.removeEventListener('error', onError);
    window.removeEventListener('unhandledrejection', onRejection);
  };
};
