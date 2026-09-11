module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({
    ok: true,
    app: 'BroLink',
    supabaseConfigured: true,
    drimeConfigured: Boolean(process.env.DRIME_ACCESS_TOKEN),
    workspaceId: Number.isInteger(Number(process.env.DRIME_WORKSPACE_ID || 0)) ? Number(process.env.DRIME_WORKSPACE_ID || 0) : 0
  });
};
