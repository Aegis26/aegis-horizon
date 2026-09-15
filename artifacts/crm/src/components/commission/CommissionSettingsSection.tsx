import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  CheckCircle2,
  Edit3,
  Percent,
  Plus,
  RefreshCw,
  Save,
  Tags,
  Users,
} from "lucide-react";
import {
  useCreateProductType,
  useGetCommissionSettings,
  useListProductTypes,
  useUpdateCommissionSettings,
  useUpdateProductType,
  type Member,
  type ProductType,
} from "@workspace/api-client-react";
import { useWindowAuth } from "@/components/auth/WindowAuthProvider";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { getInitials } from "@/lib/format";
import {
  commissionSettingsQueryKey,
  productTypesQueryKey,
  productTypesQueryRoot,
} from "@/lib/commissions";

type DraftSetting = {
  commissionPercentage: string;
  isActive: boolean;
};

type Drafts = Record<string, DraftSetting>;
type ValidationErrors = Record<string, string>;
type ProductColumn = {
  id: string | null;
  name: string;
  description: string | null;
  isActive: boolean;
};
const percentagePattern = /^(?:\d{1,2}(?:\.\d{1,2})?|100(?:\.0{1,2})?)$/;
const GENERAL_PRODUCT_ID = null;

function validatePercentage(value: string): string | null {
  const normalized = value.trim();
  if (!normalized) return "Enter a percentage.";
  if (!percentagePattern.test(normalized)) {
    return "Use a number from 0 to 100 with up to 2 decimals.";
  }
  const amount = Number(normalized);
  return amount >= 0 && amount <= 100
    ? null
    : "Use a number from 0 to 100 with up to 2 decimals.";
}

function rateKey(userId: string, productTypeId: string | null): string {
  // JSON encoding is deliberately used instead of splitting a hyphenated
  // identifier. UUIDs are opaque and must remain intact.
  return JSON.stringify([userId, productTypeId]);
}

export default function CommissionSettingsSection({
  orgId,
  members,
}: {
  orgId: string;
  members: Member[];
}) {
  const { isLoaded: authLoaded, isSignedIn, user } = useWindowAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const identityId = user?.id ?? user?.clerkId ?? "anonymous";
  const settingsKey = commissionSettingsQueryKey(orgId, identityId);
  const productTypesKey = productTypesQueryKey(orgId, identityId);
  const [drafts, setDrafts] = useState<Drafts>({});
  const [validationErrors, setValidationErrors] = useState<ValidationErrors>({});
  const [saveError, setSaveError] = useState<string | null>(null);
  const [newProductName, setNewProductName] = useState("");
  const [newProductDescription, setNewProductDescription] = useState("");
  const [editingProduct, setEditingProduct] = useState<ProductType | null>(null);
  const [editingName, setEditingName] = useState("");
  const [editingDescription, setEditingDescription] = useState("");

  const productTypesQuery = useListProductTypes(orgId, {
    query: {
      queryKey: productTypesKey,
      enabled: Boolean(orgId && authLoaded && isSignedIn && user?.id),
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      retry: false,
    },
  });

  const settingsQuery = useGetCommissionSettings(orgId, {
    query: {
      queryKey: settingsKey,
      enabled: Boolean(orgId && authLoaded && isSignedIn && user?.id),
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      retry: false,
    },
  });

  const productTypes = useMemo(
    () =>
      (productTypesQuery.data?.productTypes ?? []).filter(
        (product) => product && product.id && product.name,
      ),
    [productTypesQuery.data],
  );
  const columns = useMemo<ProductColumn[]>(
    () => [
      {
        id: GENERAL_PRODUCT_ID,
        name: "General / unclassified",
        description: "Deals without a product classification",
        isActive: true,
      },
      ...productTypes,
    ],
    [productTypes],
  );
  const savedSettings = useMemo(
    () => settingsQuery.data?.settings ?? [],
    [settingsQuery.data],
  );

  const memberIds = useMemo(
    () => members.map((member) => member.user.id),
    [members],
  );

  useEffect(() => {
    if (!settingsQuery.data) return;
    const savedByKey = new Map(
      savedSettings.map((setting) => [
        rateKey(setting.userId, setting.productTypeId),
        setting,
      ]),
    );
    const nextDrafts: Drafts = {};
    for (const member of members) {
      for (const column of columns) {
        const saved = savedByKey.get(rateKey(member.user.id, column.id));
        nextDrafts[rateKey(member.user.id, column.id)] = {
          // An unconfigured product rate is intentionally inactive. It must
          // never fall back to the General rate when a deal is classified.
          commissionPercentage: saved?.commissionPercentage ?? "0",
          isActive: saved?.isActive ?? false,
        };
      }
    }
    setDrafts(nextDrafts);
    setValidationErrors({});
    setSaveError(null);
  }, [columns, members, savedSettings, settingsQuery.data]);

  const saveMutation = useUpdateCommissionSettings({
    mutation: {
      onSuccess: (response) => {
        queryClient.setQueryData(settingsKey, response);
        queryClient.invalidateQueries({ queryKey: settingsKey });
        setSaveError(null);
        toast({
          title: "Commission settings saved",
          description: "Rates and active status are now up to date.",
        });
      },
      onError: (error) => {
        const message =
          error instanceof Error
            ? error.message
            : "Unable to save commission settings.";
        setSaveError(message);
        toast({
          title: "Could not save commission settings",
          description: message,
          variant: "destructive",
        });
      },
    },
  });

  const createProductType = useCreateProductType({
    mutation: {
      onSuccess: () => {
        setNewProductName("");
        setNewProductDescription("");
        queryClient.invalidateQueries({ queryKey: productTypesQueryRoot(orgId) });
        toast({ title: "Product added" });
      },
      onError: (error) =>
        toast({
          title: "Could not add product",
          description: error instanceof Error ? error.message : "Please try again.",
          variant: "destructive",
        }),
    },
  });
  const updateProductType = useUpdateProductType({
    mutation: {
      onSuccess: () => {
        setEditingProduct(null);
        queryClient.invalidateQueries({ queryKey: productTypesQueryRoot(orgId) });
        toast({ title: "Product updated" });
      },
      onError: (error) =>
        toast({
          title: "Could not update product",
          description: error instanceof Error ? error.message : "Please try again.",
          variant: "destructive",
        }),
    },
  });

  const updateDraft = (
    userId: string,
    productTypeId: string | null,
    update: Partial<DraftSetting>,
  ) => {
    const key = rateKey(userId, productTypeId);
    setDrafts((current) => ({
      ...current,
      [key]: { ...current[key], ...update },
    }));
    if (update.commissionPercentage !== undefined) {
      setValidationErrors((current) => {
        const next = { ...current };
        delete next[key];
        return next;
      });
    }
    setSaveError(null);
  };

  const handleSave = () => {
    const nextErrors: ValidationErrors = {};
    for (const member of members) {
      for (const column of columns) {
        const key = rateKey(member.user.id, column.id);
        const draft = drafts[key];
        const error = validatePercentage(draft?.commissionPercentage ?? "");
        if (error) nextErrors[key] = error;
      }
    }
    setValidationErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    const visibleKeys = new Set<string>();
    const matrixSettings = members.flatMap((member) =>
      columns.map((column) => {
        const key = rateKey(member.user.id, column.id);
        visibleKeys.add(key);
        const draft = drafts[key] ?? {
          commissionPercentage: "0",
          isActive: false,
        };
        return {
          userId: member.user.id,
          productTypeId: column.id,
          commissionPercentage: draft.commissionPercentage.trim(),
          isActive: draft.isActive,
        };
      }),
    );
    // Preserve settings the current member/product matrix cannot render (for
    // example, a membership or an inactive product changed in another tab).
    // Sending the complete saved list prevents an innocent edit from deleting
    // historical inactive rows.
    const preservedSettings = savedSettings
      .filter((setting) => !visibleKeys.has(rateKey(setting.userId, setting.productTypeId)))
      .map((setting) => ({
        userId: setting.userId,
        productTypeId: setting.productTypeId,
        commissionPercentage: setting.commissionPercentage,
        isActive: setting.isActive,
      }));

    saveMutation.mutate({
      orgId,
      data: {
        settings: [...matrixSettings, ...preservedSettings],
      },
    });
  };

  const handleCreateProduct = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const name = newProductName.trim();
    if (!name) return;
    createProductType.mutate({
      orgId,
      data: {
        name,
        ...(newProductDescription.trim()
          ? { description: newProductDescription.trim() }
          : {}),
      },
    });
  };

  const handleEditProduct = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!editingProduct || !editingName.trim()) return;
    updateProductType.mutate({
      orgId,
      productTypeId: editingProduct.id,
      data: {
        name: editingName.trim(),
        description: editingDescription.trim() || null,
      },
    });
  };

  const handleToggleProduct = (product: ProductType) => {
    updateProductType.mutate({
      orgId,
      productTypeId: product.id,
      data: { isActive: !product.isActive },
    });
  };

  if (settingsQuery.isLoading || productTypesQuery.isLoading) {
    return (
      <Card data-testid="loading-commission-settings">
        <CardHeader>
          <CardTitle className="font-display">Commission settings</CardTitle>
          <CardDescription>Loading team commission rates...</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="skeleton h-16 rounded-lg" />
          <div className="skeleton h-16 rounded-lg" />
          <div className="skeleton h-16 rounded-lg" />
        </CardContent>
      </Card>
    );
  }

  if (settingsQuery.isError) {
    return (
      <Card data-testid="error-commission-settings">
        <CardHeader>
          <CardTitle className="font-display">Commission settings</CardTitle>
          <CardDescription>
            We could not load the team&apos;s commission rates.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col items-start gap-3">
          <p className="text-sm text-destructive" role="alert">
            {settingsQuery.error instanceof Error
              ? settingsQuery.error.message
              : "Please try again."}
          </p>
          <Button
            type="button"
            variant="outline"
            onClick={() => void settingsQuery.refetch()}
            disabled={settingsQuery.isFetching}
            data-testid="button-retry-commission-settings"
          >
            <RefreshCw
              className={`mr-2 h-4 w-4 ${settingsQuery.isFetching ? "animate-spin" : ""}`}
              aria-hidden="true"
            />
            {settingsQuery.isFetching ? "Retrying..." : "Retry"}
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <ProductTypesCard
        products={productTypes}
        query={productTypesQuery}
        newName={newProductName}
        newDescription={newProductDescription}
        onNameChange={setNewProductName}
        onDescriptionChange={setNewProductDescription}
        onCreate={handleCreateProduct}
        onEdit={(product) => {
          setEditingProduct(product);
          setEditingName(product.name);
          setEditingDescription(product.description ?? "");
        }}
        onToggle={handleToggleProduct}
        pending={createProductType.isPending || updateProductType.isPending}
      />

      <Card data-testid="card-commission-settings">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 font-display">
            <Percent className="h-5 w-5 text-primary" aria-hidden="true" />
            Commission rates by product
          </CardTitle>
          <CardDescription>
            Set a separate rate for every employee and product. General /
            unclassified applies only to deals with no product; a classified deal
            never falls back to the General rate.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {members.length === 0 ? (
            <div
              className="rounded-lg border border-dashed border-border/70 px-6 py-10 text-center"
              data-testid="empty-commission-settings"
            >
              <Users
                className="mx-auto mb-3 h-8 w-8 text-muted-foreground"
                aria-hidden="true"
              />
              <p className="font-medium">No team members to configure.</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Invite a team member to start setting rates.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-border/60">
              <div className="min-w-[760px]">
                <div className="grid grid-cols-[minmax(180px,1.2fr)_repeat(var(--product-count),minmax(150px,1fr))] border-b border-border/60 bg-muted/20" style={{ "--product-count": columns.length } as React.CSSProperties}>
                  <div className="p-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Employee
                  </div>
                  {columns.map((column) => (
                    <div key={column.id ?? "general"} className="border-l border-border/50 p-3">
                      <p className="text-xs font-semibold">{column.name}</p>
                      <p className="mt-1 text-[11px] text-muted-foreground">
                        {column.id === null ? "No classification" : column.isActive ? "Active product" : "Inactive product"}
                      </p>
                    </div>
                  ))}
                </div>
                {members.map((member) => {
                  const displayName = member.user.fullName || member.user.email;
                  return (
                    <div
                      key={member.id}
                      className="grid grid-cols-[minmax(180px,1.2fr)_repeat(var(--product-count),minmax(150px,1fr))] border-b border-border/50 last:border-b-0"
                      style={{ "--product-count": columns.length } as React.CSSProperties}
                      data-testid={`row-commission-setting-${member.user.id}`}
                    >
                      <div className="flex min-w-0 items-start gap-3 p-3">
                        <Avatar className="h-9 w-9 shrink-0">
                          <AvatarFallback className="bg-primary/10 text-primary text-xs">
                            {getInitials(member.user.fullName, member.user.email)}
                          </AvatarFallback>
                        </Avatar>
                        <div className="min-w-0">
                          <p className="truncate font-medium" data-testid={`text-commission-member-${member.user.id}`}>
                            {displayName}
                          </p>
                          <p className="truncate text-xs text-muted-foreground">
                            {member.user.email}
                          </p>
                          {member.role === "owner" && (
                            <Badge variant="secondary" className="mt-1 text-[10px]">
                              Owner
                            </Badge>
                          )}
                        </div>
                      </div>
                      {columns.map((column) => {
                        const key = rateKey(member.user.id, column.id);
                        const draft = drafts[key] ?? {
                          commissionPercentage: "0",
                          isActive: false,
                        };
                        const error = validationErrors[key];
                        const label = `${displayName} ${column.name} commission rate`;
                        return (
                          <div key={key} className="space-y-2 border-l border-border/50 p-3">
                            <Label className="sr-only" htmlFor={`commission-percentage-${encodeURIComponent(key)}`}>
                              {label}
                            </Label>
                            <div className="relative">
                              <Input
                                id={`commission-percentage-${encodeURIComponent(key)}`}
                                type="text"
                                inputMode="decimal"
                                value={draft.commissionPercentage}
                                onChange={(event) =>
                                  updateDraft(member.user.id, column.id, {
                                    commissionPercentage: event.target.value,
                                  })
                                }
                                aria-invalid={Boolean(error)}
                                className={error ? "border-destructive pr-8" : "pr-8"}
                                data-testid={`input-commission-percentage-${encodeURIComponent(key)}`}
                              />
                              <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-muted-foreground">
                                %
                              </span>
                            </div>
                            <div className="flex items-center justify-between gap-2">
                              <span className={`text-[11px] ${draft.isActive ? "text-success" : "text-muted-foreground"}`}>
                                {draft.isActive ? "Enabled" : "Inactive"}
                              </span>
                              <Switch
                                checked={draft.isActive}
                                onCheckedChange={(checked) =>
                                  updateDraft(member.user.id, column.id, { isActive: checked })
                                }
                                aria-label={`${label} status`}
                                data-testid={`switch-commission-active-${encodeURIComponent(key)}`}
                              />
                            </div>
                            {error ? (
                              <p className="flex items-start gap-1 text-[11px] text-destructive">
                                <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
                                {error}
                              </p>
                            ) : (
                              <p className="text-[11px] text-muted-foreground">0–100%, up to 2 decimals</p>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {saveError ? (
            <p
              className="flex items-center gap-2 text-sm text-destructive"
              role="alert"
              data-testid="error-save-commission-settings"
            >
              <AlertCircle className="h-4 w-4" aria-hidden="true" />
              {saveError}
            </p>
          ) : null}

          <div className="flex flex-col gap-3 border-t border-border/50 pt-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs text-muted-foreground">
              Changes apply to future Closed Won opportunities. Inactive rates
              remain visible as history.
            </p>
            <Button
              type="button"
              onClick={handleSave}
              disabled={saveMutation.isPending || memberIds.length === 0}
              data-testid="button-save-commission-settings"
            >
              {saveMutation.isPending ? (
                <RefreshCw className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <Save className="mr-2 h-4 w-4" aria-hidden="true" />
              )}
              {saveMutation.isPending ? "Saving..." : "Save commission settings"}
            </Button>
          </div>
          {saveMutation.isSuccess && !saveMutation.isPending && !saveError ? (
            <p
              className="flex items-center gap-2 text-sm text-success"
              data-testid="status-commission-settings-saved"
            >
              <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
              Commission settings saved.
            </p>
          ) : null}
        </CardContent>
      </Card>

      {editingProduct ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-labelledby="edit-product-title"
        >
          <Card className="w-full max-w-lg">
            <CardHeader>
              <CardTitle id="edit-product-title">Edit product</CardTitle>
              <CardDescription>Renaming does not change commission history.</CardDescription>
            </CardHeader>
            <form onSubmit={handleEditProduct}>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="edit-product-name">Name</Label>
                  <Input id="edit-product-name" value={editingName} onChange={(event) => setEditingName(event.target.value)} autoFocus />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="edit-product-description">Description</Label>
                  <Textarea id="edit-product-description" value={editingDescription} onChange={(event) => setEditingDescription(event.target.value)} />
                </div>
              </CardContent>
              <div className="flex justify-end gap-2 border-t border-border/50 p-4">
                <Button type="button" variant="ghost" onClick={() => setEditingProduct(null)}>Cancel</Button>
                <Button type="submit" disabled={!editingName.trim() || updateProductType.isPending}>
                  {updateProductType.isPending ? "Saving..." : "Save product"}
                </Button>
              </div>
            </form>
          </Card>
        </div>
      ) : null}
    </div>
  );
}

function ProductTypesCard({
  products,
  query,
  newName,
  newDescription,
  onNameChange,
  onDescriptionChange,
  onCreate,
  onEdit,
  onToggle,
  pending,
}: {
  products: ProductType[];
  query: {
    isError: boolean;
    error: unknown;
    isFetching: boolean;
    refetch: () => Promise<unknown>;
  };
  newName: string;
  newDescription: string;
  onNameChange: (value: string) => void;
  onDescriptionChange: (value: string) => void;
  onCreate: (event: React.FormEvent<HTMLFormElement>) => void;
  onEdit: (product: ProductType) => void;
  onToggle: (product: ProductType) => void;
  pending: boolean;
}) {
  return (
    <Card data-testid="card-product-types">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 font-display">
          <Tags className="h-5 w-5 text-primary" aria-hidden="true" />
          Products
        </CardTitle>
        <CardDescription>
          Create the classifications your team uses for commission rates. Products
          can be deactivated without deleting their settings or history.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {query.isError ? (
          <div className="flex flex-col items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-4" role="alert">
            <p className="text-sm text-destructive">
              {query.error instanceof Error ? query.error.message : "Products could not be loaded."}
            </p>
            <Button type="button" variant="outline" onClick={() => void query.refetch()} disabled={query.isFetching}>
              <RefreshCw className={`mr-2 h-4 w-4 ${query.isFetching ? "animate-spin" : ""}`} />
              {query.isFetching ? "Retrying..." : "Retry"}
            </Button>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border/60">
            <div className="min-w-[560px]">
              <div className="grid grid-cols-[minmax(180px,1fr)_minmax(180px,1.4fr)_110px_150px] border-b border-border/60 bg-muted/20 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <span>Name</span>
                <span>Description</span>
                <span>Status</span>
                <span className="text-right">Actions</span>
              </div>
              {products.length === 0 ? (
                <div className="p-8 text-center text-sm text-muted-foreground">
                  No products yet. Create one above to add a product-specific rate column.
                </div>
              ) : (
                products.map((product) => (
                  <div key={product.id} className="grid grid-cols-[minmax(180px,1fr)_minmax(180px,1.4fr)_110px_150px] items-center border-b border-border/50 px-3 py-3 last:border-b-0">
                    <span className="font-medium">{product.name}</span>
                    <span className="truncate pr-3 text-sm text-muted-foreground">{product.description || "—"}</span>
                    <Badge variant={product.isActive ? "secondary" : "outline"} className="w-fit text-[10px]">
                      {product.isActive ? "Active" : "Inactive"}
                    </Badge>
                    <div className="flex justify-end gap-1">
                      <Button type="button" variant="ghost" size="sm" onClick={() => onEdit(product)} disabled={pending}>
                        <Edit3 className="mr-1 h-3.5 w-3.5" /> Edit
                      </Button>
                      <Button type="button" variant="ghost" size="sm" onClick={() => onToggle(product)} disabled={pending}>
                        {product.isActive ? "Deactivate" : "Reactivate"}
                      </Button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        <form onSubmit={onCreate} className="grid gap-3 border-t border-border/50 pt-5 md:grid-cols-[1fr_1.3fr_auto] md:items-end">
          <div className="space-y-2">
            <Label htmlFor="new-product-name">New product name</Label>
            <Input id="new-product-name" value={newName} onChange={(event) => onNameChange(event.target.value)} placeholder="e.g. Enterprise software" required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="new-product-description">Description (optional)</Label>
            <Input id="new-product-description" value={newDescription} onChange={(event) => onDescriptionChange(event.target.value)} placeholder="What this product includes" />
          </div>
          <Button type="submit" disabled={!newName.trim() || pending}>
            <Plus className="mr-2 h-4 w-4" /> {pending ? "Saving..." : "Add product"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}