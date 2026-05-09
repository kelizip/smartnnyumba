import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../../api';
import toast from 'react-hot-toast';
import AppLayout from '../../components/layout/AppLayout';

const fmt = (n) => `KES ${Number(n||0).toLocaleString()}`;

export default function Billing() {
  const qc = useQueryClient();
  const [confirming, setConfirming] = useState(null);

  const { data: statusData, isLoading } = useQuery({
    queryKey: ['billing-status'],
    queryFn: () => api.get('/billing/status').then(r=>r.data),
    staleTime: 60000,
  });
  const { data: plansData } = useQuery({
    queryKey: ['billing-plans'],
    queryFn: () => api.get('/billing/plans').then(r=>r.data),
    staleTime: 600000,
  });
  const { data: invoicesData } = useQuery({
    queryKey: ['billing-invoices'],
    queryFn: () => api.get('/billing/invoices').then(r=>r.data),
    staleTime: 60000,
  });

  const subscribe = useMutation({
    mutationFn: (plan) => api.post('/billing/initiate', { plan }).then(r=>r.data),
    onSuccess: (data) => {
      if (data.payment_url) { window.location.href = data.payment_url; return; }
      toast(data.message || 'Follow payment instructions', { duration: 8000 });
      qc.invalidateQueries(['billing-status']);
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Failed'),
  });

  if (isLoading) return <AppLayout><div className="p-8 text-[--text-muted]">Loading...</div></AppLayout>;

  const { org, plan, usage, trial_days_remaining, is_expired } = statusData || {};
  const plans  = plansData?.plans || {};
  const planEntries = Object.entries(plans).filter(([k])=>k!=='enterprise');

  const usagePct = (used, max) => max && max < 99999 ? Math.min(100, Math.round(used*100/max)) : 0;

  return (
    <AppLayout>
      <div className="max-w-4xl mx-auto p-6 space-y-8">
        <div>
          <h1 className="text-2xl font-bold text-[--text-primary]">Billing & Subscription</h1>
          <p className="text-[--text-muted] text-sm mt-1">Manage your plan, usage, and payment history</p>
        </div>

        {/* Trial / expiry banner */}
        {trial_days_remaining > 0 && (
          <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-4 flex items-center justify-between">
            <div>
              <p className="font-medium text-indigo-800">Trial ends in {trial_days_remaining} days</p>
              <p className="text-sm text-indigo-600">Subscribe now to avoid service interruption</p>
            </div>
          </div>
        )}
        {is_expired && (
          <div className="bg-[--red-bg] border border-[--red-bg] rounded-xl p-4">
            <p className="font-semibold text-red-800">Your subscription has expired</p>
            <p className="text-sm text-[--red]">The system is in read-only mode. Renew below to restore full access.</p>
          </div>
        )}

        {/* Current plan + usage */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[
            { label:'Units',      used: usage?.units,      max: org?.max_units,      icon:'🏠' },
            { label:'Users',      used: usage?.users,      max: org?.max_users,      icon:'👥' },
            { label:'SMS (this month)', used: usage?.sms_this_month, max: plan?.sms_included, icon:'💬' },
          ].map(({ label, used, max, icon }) => {
            const pct = usagePct(used, max);
            return (
              <div key={label} className="bg-[--surface] rounded-xl border border-[--border] p-4">
                <div className="flex items-center gap-2 mb-2">
                  <span>{icon}</span>
                  <span className="text-sm font-medium text-[--text-secondary]">{label}</span>
                </div>
                <div className="text-2xl font-bold text-[--text-primary]">{used ?? '—'}</div>
                <div className="text-xs text-[--text-muted] mb-2">of {max < 99999 ? max : '∞'}</div>
                {max < 99999 && (
                  <div className="h-1.5 bg-[--surface-muted] rounded-full overflow-hidden">
                    <div className={`h-full rounded-full transition-all ${pct>80?'bg-[--red]':pct>60?'bg-[--amber]':'bg-emerald-500'}`} style={{width:`${pct}%`}}/>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Plan selector */}
        <div>
          <h2 className="font-semibold text-[--text-primary] mb-4">Available Plans</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {planEntries.map(([planId, p]) => {
              const isCurrent = org?.plan === planId;
              return (
                <div key={planId} className={`rounded-xl border-2 p-5 transition-colors ${isCurrent?'border-indigo-500 bg-indigo-50':'border-[--border] bg-[--surface]'}`}>
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-bold text-[--text-primary] text-lg">{p.name}</span>
                    <span className={`font-bold ${isCurrent?'text-indigo-600':'text-[--text-secondary]'}`}>
                      {typeof p.price === 'number' ? fmt(p.price)+'/mo' : p.price}
                    </span>
                  </div>
                  <ul className="text-sm text-[--text-muted] space-y-1 mb-4">
                    <li>✓ {p.max_units < 99999 ? p.max_units : '∞'} units</li>
                    <li>✓ {p.max_users < 9999 ? p.max_users : '∞'} staff users</li>
                    <li>✓ {p.sms_included < 99999 ? p.sms_included : '∞'} SMS/month</li>
                  </ul>
                  {isCurrent ? (
                    <div className="text-center text-sm font-medium text-indigo-600 py-1.5">Current plan</div>
                  ) : (
                    <button className="btn-primary w-full text-sm" onClick={()=>setConfirming(planId)} disabled={subscribe.isPending}>
                      {subscribe.isPending && confirming===planId ? 'Processing...' : `Switch to ${p.name}`}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
          <p className="text-sm text-[--text-muted] mt-3 text-center">Need Enterprise? <a href="mailto:sales@smartnyumba.co.ke" className="text-indigo-500 hover:underline">Contact sales →</a></p>
        </div>

        {/* Billing history */}
        <div>
          <h2 className="font-semibold text-[--text-primary] mb-3">Billing History</h2>
          {(invoicesData?.invoices||[]).length === 0 ? (
            <p className="text-[--text-muted] text-sm">No billing history yet.</p>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-[--border]">
              <table className="w-full text-sm">
                <thead className="bg-[--surface-muted]">
                  <tr>{['Date','Description','Amount','Status'].map(h=>(
                    <th key={h} className="px-4 py-3 text-left text-[--text-muted] font-medium text-xs uppercase tracking-wide">{h}</th>
                  ))}</tr>
                </thead>
                <tbody className="divide-y divide-[--border]">
                  {(invoicesData?.invoices||[]).map(inv=>(
                    <tr key={inv.id} className="bg-[--surface]">
                      <td className="px-4 py-3 text-[--text-secondary]">{new Date(inv.created_at).toLocaleDateString()}</td>
                      <td className="px-4 py-3 text-[--text-secondary]">{inv.description}</td>
                      <td className="px-4 py-3 font-medium text-[--text-primary]">{fmt(inv.amount)}</td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${inv.status==='paid'?'bg-green-100 text-green-700':'inv.status==="failed"?bg-red-100 text-red-700':'bg-amber-100 text-amber-700'}`}>
                          {inv.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Confirm modal */}
      {confirming && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-[--surface] rounded-xl p-6 max-w-sm w-full shadow-xl">
            <h3 className="font-semibold text-[--text-primary] mb-2">Switch to {plans[confirming]?.name}?</h3>
            <p className="text-sm text-[--text-muted] mb-4">
              You'll be charged {fmt(plans[confirming]?.price)}/month. You can cancel at any time.
            </p>
            <div className="flex gap-3">
              <button className="btn-secondary flex-1" onClick={()=>setConfirming(null)}>Cancel</button>
              <button className="btn-primary flex-1" onClick={()=>{ subscribe.mutate(confirming); setConfirming(null); }}
                disabled={subscribe.isPending}>Confirm</button>
            </div>
          </div>
        </div>
      )}
    </AppLayout>
  );
}
