// Same-origin relative calls to /api/proxy/<path>. The path after /api/proxy/
// maps 1:1 to the backend path after /api/v1/. The proxy route injects X-User-Id.

async function get(path: string) {
  const res = await fetch(`/api/proxy/${path}`)
  if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error ?? `Request failed: ${res.status}`)
  return res.json()
}

async function send(path: string, method: string, body?: unknown) {
  const res = await fetch(`/api/proxy/${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error ?? `Request failed: ${res.status}`)
  return res.json()
}

function qs(params: Record<string, unknown>): string {
  const sp = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') sp.set(k, String(v))
  }
  const s = sp.toString()
  return s ? `?${s}` : ''
}

const api = {
  // Workspaces
  listWorkspaces: () => get('workspaces'),
  createWorkspace: (body: unknown) => send('workspaces', 'POST', body),
  getWorkspace: (id: string) => get(`workspaces/${id}`),
  updateWorkspace: (id: string, body: unknown) => send(`workspaces/${id}`, 'PUT', body),
  deleteWorkspace: (id: string) => send(`workspaces/${id}`, 'DELETE'),
  listMembers: (id: string) => get(`workspaces/${id}/members`),
  inviteMember: (id: string, body: unknown) => send(`workspaces/${id}/members`, 'POST', body),
  removeMember: (id: string, memberId: string) => send(`workspaces/${id}/members/${memberId}`, 'DELETE'),

  // Senders
  listSenders: (workspaceId: string) => get(`senders${qs({ workspaceId })}`),
  createSender: (body: unknown) => send('senders', 'POST', body),
  getSender: (id: string) => get(`senders/${id}`),
  updateSender: (id: string, body: unknown) => send(`senders/${id}`, 'PUT', body),
  deleteSender: (id: string) => send(`senders/${id}`, 'DELETE'),

  // Imports
  listImports: (workspaceId: string) => get(`imports${qs({ workspaceId })}`),
  getImport: (id: string) => get(`imports/${id}`),
  createImport: (body: unknown) => send('imports', 'POST', body),
  seedSample: (workspaceId: string) => send('imports/sample', 'POST', { workspaceId }),
  deleteImport: (id: string) => send(`imports/${id}`, 'DELETE'),

  // Campaigns
  listCampaigns: (workspaceId: string, senderId?: string) => get(`campaigns${qs({ workspaceId, senderId })}`),
  getCampaign: (id: string) => get(`campaigns/${id}`),
  getCampaignEvents: (id: string) => get(`campaigns/${id}/events`),

  // Segments
  listSegments: (workspaceId: string) => get(`segments${qs({ workspaceId })}`),
  createSegment: (body: unknown) => send('segments', 'POST', body),
  deleteSegment: (id: string) => send(`segments/${id}`, 'DELETE'),

  // Events
  listEvents: (params: Record<string, unknown>) => get(`events${qs(params)}`),

  // Recipients
  listRecipients: (params: Record<string, unknown>) => get(`recipients${qs(params)}`),
  getRecipient: (id: string) => get(`recipients/${id}`),

  // Placement
  listPlacementScores: (workspaceId: string, senderId?: string) => get(`placement${qs({ workspaceId, senderId })}`),
  computePlacement: (body: unknown) => send('placement/compute', 'POST', body),
  getPlacementTrend: (workspaceId: string, senderId: string) => get(`placement/trend${qs({ workspaceId, senderId })}`),

  // List health
  getListHealth: (workspaceId: string, senderId: string) => get(`list-health${qs({ workspaceId, senderId })}`),
  computeListHealth: (body: unknown) => send('list-health/compute', 'POST', body),

  // Suppression
  listSuppression: (workspaceId: string, status?: string) => get(`suppression${qs({ workspaceId, status })}`),
  computeSuppression: (body: unknown) => send('suppression/compute', 'POST', body),
  updateSuppression: (id: string, body: unknown) => send(`suppression/${id}`, 'PUT', body),
  exportSuppression: (workspaceId: string) => get(`suppression/export${qs({ workspaceId })}`),

  // Cohorts
  listCohorts: (workspaceId: string, senderId?: string) => get(`cohorts${qs({ workspaceId, senderId })}`),
  computeCohorts: (body: unknown) => send('cohorts/compute', 'POST', body),

  // Sunset
  listSunsetPlans: (workspaceId: string) => get(`sunset${qs({ workspaceId })}`),
  getSunsetPlan: (id: string) => get(`sunset/${id}`),
  previewSunset: (body: unknown) => send('sunset/preview', 'POST', body),
  createSunsetPlan: (body: unknown) => send('sunset', 'POST', body),
  deleteSunsetPlan: (id: string) => send(`sunset/${id}`, 'DELETE'),

  // Revenue model
  getRevenueModel: (workspaceId: string, senderId?: string) => get(`revenue-model${qs({ workspaceId, senderId })}`),
  createRevenueModel: (body: unknown) => send('revenue-model', 'POST', body),
  deriveRevenueModel: (body: unknown) => send('revenue-model/derive', 'POST', body),

  // Revenue at risk
  listRevenueAtRisk: (workspaceId: string, senderId?: string) => get(`revenue-at-risk${qs({ workspaceId, senderId })}`),
  computeRevenueAtRisk: (body: unknown) => send('revenue-at-risk/compute', 'POST', body),
  getRevenueAtRiskSummary: (workspaceId: string) => get(`revenue-at-risk/summary${qs({ workspaceId })}`),
  getTopContributors: (workspaceId: string) => get(`revenue-at-risk/top-contributors${qs({ workspaceId })}`),

  // Alerts
  listAlerts: (workspaceId: string, status?: string) => get(`alerts${qs({ workspaceId, status })}`),
  scanAlerts: (body: unknown) => send('alerts/scan', 'POST', body),
  updateAlert: (id: string, body: unknown) => send(`alerts/${id}`, 'PUT', body),

  // Alert rules
  listAlertRules: (workspaceId: string) => get(`alert-rules${qs({ workspaceId })}`),
  createAlertRule: (body: unknown) => send('alert-rules', 'POST', body),
  updateAlertRule: (id: string, body: unknown) => send(`alert-rules/${id}`, 'PUT', body),
  deleteAlertRule: (id: string) => send(`alert-rules/${id}`, 'DELETE'),

  // Fatigue
  listFatigue: (workspaceId: string) => get(`fatigue${qs({ workspaceId })}`),
  computeFatigue: (body: unknown) => send('fatigue/compute', 'POST', body),

  // Scorecards
  listScorecards: (workspaceId: string) => get(`scorecards${qs({ workspaceId })}`),
  getScorecard: (id: string) => get(`scorecards/${id}`),
  generateScorecard: (body: unknown) => send('scorecards/generate', 'POST', body),
  exportScorecard: (id: string) => get(`scorecards/${id}/export`),

  // Benchmarks
  listBenchmarks: () => get('benchmarks'),

  // Authentication
  listAuthChecks: (workspaceId: string, senderId?: string) => get(`authentication${qs({ workspaceId, senderId })}`),
  saveAuthCheck: (body: unknown) => send('authentication', 'POST', body),

  // Reputation
  getReputation: (workspaceId: string, senderId: string) => get(`reputation${qs({ workspaceId, senderId })}`),
  rebuildReputation: (body: unknown) => send('reputation/rebuild', 'POST', body),

  // Reports
  listReports: (workspaceId: string) => get(`reports${qs({ workspaceId })}`),
  createReport: (body: unknown) => send('reports', 'POST', body),
  renderReport: (id: string) => send(`reports/${id}/render`, 'POST'),
  deleteReport: (id: string) => send(`reports/${id}`, 'DELETE'),

  // Integrations
  listIntegrations: (workspaceId: string) => get(`integrations${qs({ workspaceId })}`),
  createIntegration: (body: unknown) => send('integrations', 'POST', body),
  pullIntegration: (id: string) => send(`integrations/${id}/pull`, 'POST'),
  deleteIntegration: (id: string) => send(`integrations/${id}`, 'DELETE'),

  // Notifications
  listNotifications: (workspaceId: string) => get(`notifications${qs({ workspaceId })}`),
  markNotificationRead: (id: string) => send(`notifications/${id}/read`, 'PUT'),
  markAllNotificationsRead: (body: unknown) => send('notifications/read-all', 'PUT', body),

  // Activity
  listActivity: (params: Record<string, unknown>) => get(`activity${qs(params)}`),

  // Billing
  getBillingPlan: () => get('billing/plan'),
  startCheckout: () => send('billing/checkout', 'POST'),
  openPortal: () => send('billing/portal', 'POST'),
}

export default api
