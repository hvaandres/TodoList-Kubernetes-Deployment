export const reportEvent = (type, details = {}) => {
  if (process.env.NODE_ENV !== 'production') {
    return;
  }

  const payload = JSON.stringify({ type, ...details });
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

  // Only the error message and source location are sent; never Todo content.
  const onError = event => reportEvent('frontend_error', {
    message: event && event.message,
    source: event && event.filename,
    line: event && event.lineno,
  });
  const onRejection = event => reportEvent('frontend_error', {
    message: event && event.reason && (event.reason.message || String(event.reason)),
    source: 'unhandledrejection',
  });
  window.addEventListener('error', onError);
  window.addEventListener('unhandledrejection', onRejection);
  return () => {
    window.removeEventListener('error', onError);
    window.removeEventListener('unhandledrejection', onRejection);
  };
};
