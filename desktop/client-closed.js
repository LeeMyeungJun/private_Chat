document.getElementById('retry-client').addEventListener('click', async event => {
  const button = event.currentTarget; button.disabled = true;
  try { await window.moeumClient.retryServer(); } finally { button.disabled = false; }
});
