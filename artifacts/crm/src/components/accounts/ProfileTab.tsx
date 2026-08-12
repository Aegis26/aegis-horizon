import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AccountDetail, useUpdateAccount } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "@/hooks/use-toast";
import { getGetAccountQueryKey, getListAccountsQueryKey } from "@workspace/api-client-react";

const profileSchema = z.object({
  name: z.string().min(1, "Name is required"),
  industry: z.string().optional().nullable(),
  website: z.string().optional().nullable(),
  phone: z.string().optional().nullable(),
  address: z.string().optional().nullable(),
  city: z.string().optional().nullable(),
  state: z.string().optional().nullable(),
  country: z.string().optional().nullable(),
  zip: z.string().optional().nullable(),
  annualRevenue: z.string().optional().nullable(),
  employeeCount: z.coerce.number().optional().nullable(),
  healthScore: z.string().optional().nullable(),
  riskLevel: z.string().optional().nullable(),
  ltv: z.string().optional().nullable(),
  nextRenewalDate: z.string().optional().nullable(),
});

type ProfileFormValues = z.infer<typeof profileSchema>;

export function ProfileTab({ account, orgId }: { account: AccountDetail, orgId: string }) {
  const queryClient = useQueryClient();
  const updateAccount = useUpdateAccount();

  const form = useForm<ProfileFormValues>({
    resolver: zodResolver(profileSchema),
    defaultValues: {
      name: account.name,
      industry: account.industry,
      website: account.website,
      phone: account.phone,
      address: account.address,
      city: account.city,
      state: account.state,
      country: account.country,
      zip: account.zip,
      annualRevenue: account.annualRevenue,
      employeeCount: account.employeeCount,
      healthScore: account.healthScore,
      riskLevel: account.riskLevel,
      ltv: account.ltv,
      nextRenewalDate: account.nextRenewalDate,
    }
  });

  const onSubmit = (data: ProfileFormValues) => {
    updateAccount.mutate({ orgId, accountId: account.id, data }, {
      onSuccess: () => {
        toast({ title: "Profile updated" });
        queryClient.invalidateQueries({ queryKey: getGetAccountQueryKey(orgId, account.id) });
        queryClient.invalidateQueries({ queryKey: getListAccountsQueryKey(orgId) });
      },
      onError: (err) => {
        toast({ title: "Failed to update profile", description: err.message, variant: "destructive" });
      }
    });
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6 max-w-3xl">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-4">
            <h3 className="font-display font-semibold text-lg text-primary border-b border-primary/20 pb-2">Core Details</h3>
            <FormField control={form.control} name="name" render={({ field }) => (
              <FormItem><FormLabel>Account Name</FormLabel><FormControl><Input {...field} value={field.value || ""} /></FormControl><FormMessage /></FormItem>
            )} />
            <FormField control={form.control} name="industry" render={({ field }) => (
              <FormItem><FormLabel>Industry</FormLabel><FormControl><Input {...field} value={field.value || ""} /></FormControl><FormMessage /></FormItem>
            )} />
            <FormField control={form.control} name="website" render={({ field }) => (
              <FormItem><FormLabel>Website</FormLabel><FormControl><Input {...field} value={field.value || ""} /></FormControl><FormMessage /></FormItem>
            )} />
            <FormField control={form.control} name="phone" render={({ field }) => (
              <FormItem><FormLabel>Phone</FormLabel><FormControl><Input {...field} value={field.value || ""} /></FormControl><FormMessage /></FormItem>
            )} />
          </div>

          <div className="space-y-4">
            <h3 className="font-display font-semibold text-lg text-primary border-b border-primary/20 pb-2">Location</h3>
            <FormField control={form.control} name="address" render={({ field }) => (
              <FormItem><FormLabel>Address</FormLabel><FormControl><Input {...field} value={field.value || ""} /></FormControl><FormMessage /></FormItem>
            )} />
            <div className="grid grid-cols-2 gap-4">
              <FormField control={form.control} name="city" render={({ field }) => (
                <FormItem><FormLabel>City</FormLabel><FormControl><Input {...field} value={field.value || ""} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="state" render={({ field }) => (
                <FormItem><FormLabel>State</FormLabel><FormControl><Input {...field} value={field.value || ""} /></FormControl><FormMessage /></FormItem>
              )} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <FormField control={form.control} name="country" render={({ field }) => (
                <FormItem><FormLabel>Country</FormLabel><FormControl><Input {...field} value={field.value || ""} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="zip" render={({ field }) => (
                <FormItem><FormLabel>Zip Code</FormLabel><FormControl><Input {...field} value={field.value || ""} /></FormControl><FormMessage /></FormItem>
              )} />
            </div>
          </div>

          <div className="space-y-4 md:col-span-2">
            <h3 className="font-display font-semibold text-lg text-primary border-b border-primary/20 pb-2">Business Metrics</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <FormField control={form.control} name="annualRevenue" render={({ field }) => (
                <FormItem><FormLabel>Annual Revenue</FormLabel><FormControl><Input {...field} value={field.value || ""} className="font-mono" /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="employeeCount" render={({ field }) => (
                <FormItem><FormLabel>Employees</FormLabel><FormControl><Input type="number" {...field} value={field.value || ""} className="font-mono" /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="ltv" render={({ field }) => (
                <FormItem><FormLabel>LTV</FormLabel><FormControl><Input {...field} value={field.value || ""} className="font-mono" /></FormControl><FormMessage /></FormItem>
              )} />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <FormField control={form.control} name="healthScore" render={({ field }) => (
                <FormItem>
                  <FormLabel>Health Score</FormLabel>
                  <Select onValueChange={field.onChange} defaultValue={field.value || undefined}>
                    <FormControl><SelectTrigger><SelectValue placeholder="Select health..." /></SelectTrigger></FormControl>
                    <SelectContent>
                      <SelectItem value="good">Good</SelectItem>
                      <SelectItem value="average">Average</SelectItem>
                      <SelectItem value="at_risk">At Risk</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="riskLevel" render={({ field }) => (
                <FormItem>
                  <FormLabel>Risk Level</FormLabel>
                  <Select onValueChange={field.onChange} defaultValue={field.value || undefined}>
                    <FormControl><SelectTrigger><SelectValue placeholder="Select risk..." /></SelectTrigger></FormControl>
                    <SelectContent>
                      <SelectItem value="low">Low</SelectItem>
                      <SelectItem value="medium">Medium</SelectItem>
                      <SelectItem value="high">High</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="nextRenewalDate" render={({ field }) => (
                <FormItem><FormLabel>Renewal Date</FormLabel><FormControl><Input type="date" {...field} value={field.value ? new Date(field.value).toISOString().split('T')[0] : ""} className="font-mono" /></FormControl><FormMessage /></FormItem>
              )} />
            </div>
          </div>
        </div>
        
        <div className="flex justify-end pt-4 border-t border-primary/20">
          <Button type="submit" disabled={updateAccount.isPending || !form.formState.isDirty} className="font-display">
            {updateAccount.isPending ? "Saving..." : "Save Changes"}
          </Button>
        </div>
      </form>
    </Form>
  );
}