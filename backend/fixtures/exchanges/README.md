# Respostas das corretoras

Respostas cruas das chamadas que o worker faz, usadas pelos smokes de
permissão e de saldo. **Escritas a partir da documentação oficial**, não
gravadas: ainda não houve chave real para gravar. Quando houver, troque pelas
gravadas (sem a apiKey, claro) e mantenha os casos de borda.

| Arquivo | Chamada |
|---|---|
| `binance-restrictions-*.json` | `sapiGetAccountApiRestrictions` (GET /sapi/v1/account/apiRestrictions) |
| `okx-config-*.json` | `privateGetAccountConfig` (GET /api/v5/account/config) |
| `binance-balances.json` | `privateGetAccount`, `sapiPostAssetGetFundingAsset`, `sapiGetSimpleEarnFlexiblePosition`, `sapiGetSimpleEarnLockedPosition` |
| `okx-balances.json` | `privateGetAccountBalance`, `privateGetAssetBalances`, `privateGetFinanceSavingsBalance`, `privateGetFinanceStakingDefiOrdersActive` |
