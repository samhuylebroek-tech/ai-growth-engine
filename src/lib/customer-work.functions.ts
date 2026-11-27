import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  customerWorkSchema,
  customerPurpose,
  customerWorkLabels,
  customerInputLabel,
} from "@/lib/customer-work";

/** Internal work only: refetch source as the caller and use one request ID across acknowledgement retries. */
export const prepareCustomerWork = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => customerWorkSchema.parse(input))
  .handler(async ({ data, context }) => {
    const sb = context.supabase;
    const role = await sb.rpc("has_workspace_role", {
      _workspace: data.workspaceId,
      _min: "member",
    });
    if (role.error || !role.data) throw new Error("customer_work_denied");
    const deal = await sb
      .from("crm_deals")
      .select("id,title,stage,contact_id,lost_reason")
      .eq("id", data.dealId)
      .eq("org_id", data.orgId)
      .eq("workspace_id", data.workspaceId)
      .maybeSingle();
    if (deal.error || !deal.data) throw new Error("customer_work_unavailable");
    const labels = [
      ...customerWorkLabels(data.dealId, data.purpose),
      await customerInputLabel(data),
    ];
    const read = () =>
      sb
        .from("tasks")
        .select("id,title,description,due_date,labels,created_by")
        .eq("id", data.requestId)
        .eq("org_id", data.orgId)
        .eq("workspace_id", data.workspaceId)
        .maybeSingle();
    const previous = await read();
    if (previous.error) throw new Error("customer_work_unavailable");
    // The request key is not an update API: edited input never overwrites already prepared work.
    if (previous.data) {
      if (
        previous.data.created_by !== context.userId ||
        previous.data.title !== data.title ||
        previous.data.due_date !== (data.due || null) ||
        !labels.every((l) => previous.data?.labels.includes(l))
      )
        throw new Error("customer_work_changed");
      return { id: previous.data.id };
    }
    if (customerPurpose(deal.data.stage) !== data.purpose) throw new Error("customer_work_changed");
    const description = [
      `CRM sale: ${deal.data.title} (${deal.data.id})`,
      `Recorded stage at preparation: ${deal.data.stage}`,
      deal.data.lost_reason ? `Recorded loss reason: ${deal.data.lost_reason}` : "",
      `Purpose: ${data.purpose}`,
      "Internal preparation only. No contact, sending, consent, satisfaction or received revenue is implied.",
      data.description,
    ]
      .filter(Boolean)
      .join("\n\n");
    const inserted = await sb.from("tasks").insert({
      id: data.requestId,
      org_id: data.orgId,
      workspace_id: data.workspaceId,
      title: data.title,
      description,
      due_date: data.due || null,
      labels,
      owner_id: context.userId,
      created_by: context.userId,
    });
    const result = await read();
    if (
      result.error ||
      !result.data ||
      result.data.created_by !== context.userId ||
      result.data.title !== data.title ||
      result.data.description !== description ||
      result.data.due_date !== (data.due || null) ||
      !labels.every((l) => result.data?.labels.includes(l))
    )
      throw new Error(inserted.error ? "customer_work_unconfirmed" : "customer_work_unavailable");
    return { id: result.data.id };
  });
