import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, AlertCircle, ClipboardList, X } from 'lucide-react';
import { apiClient } from '@/lib/api-client';

interface OpenOrder {
  id: string;
  status: string;
  side: string;
  price: string;
  original_size: string;
  size_matched: string;
  asset_id: string;
  outcome?: string;
  created_at?: number;
  order_type?: string;
}

interface OrdersResponse {
  data: OpenOrder[];
}

export function OrdersTab() {
  const queryClient = useQueryClient();

  const ordersQuery = useQuery({
    queryKey: ['polymarket-orders'],
    queryFn: () => apiClient.get<OrdersResponse>('/polymarket/orders'),
    refetchInterval: 15_000,
  });

  const cancelMutation = useMutation({
    mutationFn: (orderId: string) =>
      apiClient.delete(`/polymarket/order/${orderId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['polymarket-orders'] });
    },
  });

  const orders: OpenOrder[] = ordersQuery.data?.data ?? [];

  if (ordersQuery.isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-blue-400" />
      </div>
    );
  }

  if (ordersQuery.isError) {
    return (
      <div className="flex items-center gap-3 rounded-lg border border-red-500/30 bg-red-500/10 p-4">
        <AlertCircle className="h-5 w-5 text-red-400 flex-shrink-0" />
        <p className="text-sm text-red-300">Failed to load orders.</p>
      </div>
    );
  }

  if (orders.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 space-y-2">
        <ClipboardList className="h-8 w-8 text-slate-600" />
        <p className="text-slate-400 text-sm">No open orders.</p>
        <p className="text-slate-500 text-xs">Orders you place will appear here.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-500">{orders.length} open order{orders.length !== 1 ? 's' : ''}</p>
      {orders.map((order) => {
        const filled = parseFloat(order.size_matched ?? '0');
        const total = parseFloat(order.original_size ?? '0');
        const fillPct = total > 0 ? (filled / total) * 100 : 0;
        const price = parseFloat(order.price ?? '0');
        const isBuy = order.side?.toUpperCase() === 'BUY';

        return (
          <div
            key={order.id}
            className="rounded-lg border border-slate-700 bg-slate-800/50 p-4"
          >
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1 min-w-0 space-y-1.5">
                <div className="flex items-center gap-2">
                  <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${
                    isBuy ? 'bg-green-600/20 text-green-400' : 'bg-red-600/20 text-red-400'
                  }`}>
                    {order.side?.toUpperCase()}
                  </span>
                  <span className="text-xs text-slate-400 uppercase">{order.order_type ?? 'GTC'}</span>
                  <span className={`text-xs px-1.5 py-0.5 rounded text-slate-400 bg-slate-700`}>
                    {order.status}
                  </span>
                </div>
                <p className="text-xs font-mono text-slate-500 truncate">{order.asset_id}</p>
                <div className="flex items-center gap-4 text-xs text-slate-400">
                  <span>@ {(price * 100).toFixed(1)}¢</span>
                  <span>{filled.toFixed(2)} / {total.toFixed(2)} shares</span>
                  {fillPct > 0 && <span className="text-blue-400">{fillPct.toFixed(0)}% filled</span>}
                </div>
              </div>
              <button
                onClick={() => cancelMutation.mutate(order.id)}
                disabled={cancelMutation.isPending}
                className="rounded-md border border-slate-600 p-2 text-slate-400 hover:border-red-500/50 hover:text-red-400 transition-colors disabled:opacity-50"
                title="Cancel order"
              >
                {cancelMutation.isPending && cancelMutation.variables === order.id ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <X className="h-3 w-3" />
                )}
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
