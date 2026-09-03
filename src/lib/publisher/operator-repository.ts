import { supabase } from "@/lib/supabase";
import { toOperatorQueueItems, type OperatorQueueItem, type PublisherContentRow, type PublisherDeliveryRow } from "./operator";
import type { PublisherOwnership } from "./queue-types";

const CONTENT_COLUMNS = "id,legacy_spp_id,content_type,caption,scheduled_at,approval_state,publishability,migration_state,legacy_status";
const DELIVERY_COLUMNS = "id,content_item_id,platform,state,attempt_count,max_attempts,next_attempt_at,live_url,last_error,published_at";

export async function listOperatorQueue(userId: string, companyId: string): Promise<OperatorQueueItem[]> {
  const { data: content, error: contentError } = await supabase
    .from("publisher_content_items")
    .select(CONTENT_COLUMNS)
    .eq("user_id", userId)
    .eq("company_id", companyId)
    .order("scheduled_at", { ascending: true, nullsFirst: false });
  if (contentError) throw new Error("Unable to load publisher queue");

  const rows = (content ?? []) as unknown as PublisherContentRow[];
  if (rows.length === 0) return [];
  const { data: deliveries, error: deliveryError } = await supabase
    .from("publisher_deliveries")
    .select(DELIVERY_COLUMNS)
    .in("content_item_id", rows.map((row) => row.id));
  if (deliveryError) throw new Error("Unable to load publisher deliveries");
  return toOperatorQueueItems(rows, (deliveries ?? []) as unknown as PublisherDeliveryRow[]);
}

export async function readPublisherOwnership(): Promise<PublisherOwnership> {
  const { data, error } = await supabase
    .from("publisher_queue_ownership")
    .select("source,owner,epoch,cutoff_at,reconciliation_sha256")
    .eq("source", "legacy_spp")
    .single();
  if (error || !data) throw new Error("Unable to read publisher ownership state");
  return data as PublisherOwnership;
}
