import type { LeadChannel } from "@/types/lead";

interface CreateLeadParams {
  fullName?: string | null;
  phone?: string | null;
  email?: string | null;
  channel: LeadChannel;
  telegramChatId?: string | null;
  manychatSubscriberId?: string | null;
}

/**
 * Creates a new lead object (in-memory) ready to be inserted into b2c_leads.
 */
export function buildLeadRecord(params: CreateLeadParams) {
  const now = new Date().toISOString();

  return {
    id: crypto.randomUUID(),
    full_name: params.fullName ?? null,
    phone: params.phone ?? null,
    email: params.email ?? null,
    channel: params.channel,
    telegram_chat_id: params.telegramChatId ?? null,
    manychat_subscriber_id: params.manychatSubscriberId ?? null,
    current_stage: "INITIAL_CONTACT",
    created_at: now,
    updated_at: now,
  };
}
