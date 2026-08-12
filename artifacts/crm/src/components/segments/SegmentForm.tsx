import { useFieldArray, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Trash2 } from "lucide-react";
import { SegmentConditionOperator, Segment } from "@workspace/api-client-react";

const conditionSchema = z.object({
  field: z.string().min(1, "Field is required"),
  operator: z.nativeEnum(SegmentConditionOperator),
  value: z.string().nullable().optional(),
});

const segmentFormSchema = z.object({
  name: z.string().min(1, "Name is required"),
  description: z.string().optional().nullable(),
  conditions: z.array(conditionSchema).min(1, "At least one condition is required"),
});

export type SegmentFormValues = z.infer<typeof segmentFormSchema>;

const FIELDS = [
  { value: "name", label: "Account Name", type: "text" },
  { value: "industry", label: "Industry", type: "text" },
  { value: "city", label: "City", type: "text" },
  { value: "state", label: "State", type: "text" },
  { value: "country", label: "Country", type: "text" },
  { value: "healthScore", label: "Health Score", type: "text" },
  { value: "riskLevel", label: "Risk Level", type: "text" },
  { value: "employeeCount", label: "Employee Count", type: "numeric" },
  { value: "annualRevenue", label: "Annual Revenue", type: "numeric" },
  { value: "ltv", label: "LTV", type: "numeric" },
];

const OPERATORS = {
  text: [
    { value: "equals", label: "Equals" },
    { value: "not_equals", label: "Does Not Equal" },
    { value: "contains", label: "Contains" },
    { value: "is_empty", label: "Is Empty" },
    { value: "is_not_empty", label: "Is Not Empty" },
  ],
  numeric: [
    { value: "equals", label: "Equals" },
    { value: "not_equals", label: "Does Not Equal" },
    { value: "gt", label: "Greater Than" },
    { value: "gte", label: "Greater Than or Equal" },
    { value: "lt", label: "Less Than" },
    { value: "lte", label: "Less Than or Equal" },
    { value: "is_empty", label: "Is Empty" },
    { value: "is_not_empty", label: "Is Not Empty" },
  ]
};

export function SegmentForm({ 
  initialData, 
  onSubmit, 
  isSubmitting 
}: { 
  initialData?: Segment | null, 
  onSubmit: (data: SegmentFormValues) => void,
  isSubmitting: boolean
}) {
  const form = useForm<SegmentFormValues>({
    resolver: zodResolver(segmentFormSchema),
    defaultValues: initialData ? {
      name: initialData.name,
      description: initialData.description || "",
      conditions: initialData.conditions.map(c => ({
        field: c.field,
        operator: c.operator,
        value: c.value
      }))
    } : {
      name: "",
      description: "",
      conditions: [{ field: "industry", operator: "equals", value: "" }]
    }
  });

  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: "conditions",
  });

  const watchFields = form.watch("conditions");

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
        <div className="space-y-4">
          <FormField control={form.control} name="name" render={({ field }) => (
            <FormItem><FormLabel>Segment Name</FormLabel><FormControl><Input {...field} placeholder="e.g. Enterprise Tech" /></FormControl><FormMessage /></FormItem>
          )} />
          <FormField control={form.control} name="description" render={({ field }) => (
            <FormItem><FormLabel>Description</FormLabel><FormControl><Input {...field} value={field.value || ""} placeholder="Optional context..." /></FormControl><FormMessage /></FormItem>
          )} />
        </div>

        <div>
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-display font-semibold text-primary">Conditions</h3>
            <Button type="button" variant="outline" size="sm" onClick={() => append({ field: "industry", operator: "equals", value: "" })} className="gap-2 text-xs h-8 border-primary/20 hover:bg-primary/10">
              <Plus className="h-3 w-3" /> Add Condition
            </Button>
          </div>
          
          <div className="space-y-3">
            {fields.map((field, index) => {
              const currentFieldKey = watchFields[index]?.field;
              const fieldDef = FIELDS.find(f => f.value === currentFieldKey) || { type: "text" };
              const availableOperators = OPERATORS[fieldDef.type as keyof typeof OPERATORS];
              const currentOp = watchFields[index]?.operator;
              const hideValue = currentOp === "is_empty" || currentOp === "is_not_empty";

              return (
                <div key={field.id} className="flex items-start gap-2 bg-background/50 p-2 rounded-md border border-primary/10">
                  <div className="flex-1 grid grid-cols-1 md:grid-cols-3 gap-2">
                    <FormField control={form.control} name={`conditions.${index}.field`} render={({ field }) => (
                      <FormItem className="mb-0">
                        <Select value={field.value} onValueChange={(val) => {
                          field.onChange(val);
                          // Reset operator when changing field type
                          const newFieldDef = FIELDS.find(f => f.value === val);
                          const newOps = OPERATORS[newFieldDef?.type as keyof typeof OPERATORS || "text"];
                          form.setValue(`conditions.${index}.operator`, newOps[0].value as any);
                        }}>
                          <FormControl><SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger></FormControl>
                          <SelectContent>
                            {FIELDS.map(f => <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>)}
                          </SelectContent>
                        </Select>
                        <FormMessage className="text-[10px]" />
                      </FormItem>
                    )} />
                    
                    <FormField control={form.control} name={`conditions.${index}.operator`} render={({ field }) => (
                      <FormItem className="mb-0">
                        <Select value={field.value} onValueChange={field.onChange}>
                          <FormControl><SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger></FormControl>
                          <SelectContent>
                            {availableOperators.map(op => <SelectItem key={op.value} value={op.value}>{op.label}</SelectItem>)}
                          </SelectContent>
                        </Select>
                        <FormMessage className="text-[10px]" />
                      </FormItem>
                    )} />

                    <FormField control={form.control} name={`conditions.${index}.value`} render={({ field }) => (
                      <FormItem className="mb-0">
                        {!hideValue && (
                          <FormControl><Input {...field} value={field.value || ""} className="h-9 text-xs font-mono" placeholder="Value..." /></FormControl>
                        )}
                        <FormMessage className="text-[10px]" />
                      </FormItem>
                    )} />
                  </div>
                  <Button type="button" variant="ghost" size="icon" className="h-9 w-9 text-muted-foreground hover:text-destructive shrink-0" onClick={() => remove(index)} disabled={fields.length === 1}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              );
            })}
          </div>
        </div>

        <div className="pt-4 border-t border-primary/20 flex justify-end">
          <Button type="submit" disabled={isSubmitting} className="font-display">
            {isSubmitting ? "Saving..." : "Save Segment"}
          </Button>
        </div>
      </form>
    </Form>
  );
}