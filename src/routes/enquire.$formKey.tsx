import { createFileRoute } from "@tanstack/react-router";
import { queryOptions, useSuspenseQuery } from "@tanstack/react-query";
import { PublicForm } from "@/components/leads/public-form";
import { formKeySchema } from "@/lib/lead-contract";
import { getPublicLeadForm } from "@/lib/lead.functions";
import { pageHead } from "@/lib/page-head";
import { leadHead } from "@/lib/lead-head";
import { readLocale } from "@/lib/i18n";
const formQuery = (formKey: string) =>
  queryOptions({
    queryKey: ["public-lead-form", formKey],
    queryFn: async () => {
      if (!formKeySchema.safeParse(formKey).success)
        return { ok: false as const, error: "unavailable" as const };
      return getPublicLeadForm({ data: { formKey } });
    },
    staleTime: 0,
  });
export const Route = createFileRoute("/enquire/$formKey")({
  loader: ({ context, params }) => context.queryClient.ensureQueryData(formQuery(params.formKey)),
  head: ({ loaderData }) =>
    loaderData?.ok
      ? pageHead(loaderData.form.copy[readLocale()].title, loaderData.form.copy[readLocale()].intro)
      : leadHead("form"),
  component: EnquiryPage,
});

function EnquiryPage() {
  const { formKey } = Route.useParams();
  const { data } = useSuspenseQuery(formQuery(formKey));
  return <PublicForm form={data.ok ? data.form : null} />;
}
