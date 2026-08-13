export * from "./generated/api";
export * from "./generated/types";
// Explicit re-export to resolve the name collision between the generated zod
// value and the generated TS type of the same name.
export {
  ListAccountsParams,
  ListOpportunitiesParams,
  ListLeadsParams,
  ListQuotesParams,
  GetForecastParams,
} from "./generated/api";
export type {
  ListAccountsParams as ListAccountsParamsType,
  ListOpportunitiesParams as ListOpportunitiesParamsType,
  ListLeadsParams as ListLeadsParamsType,
  ListQuotesParams as ListQuotesParamsType,
  GetForecastParams as GetForecastParamsType,
} from "./generated/types";
