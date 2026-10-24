# Deploy your first service

Harbor turns a folder with a `harbor.toml` into a running service. This guide takes
about **ten minutes**, and assumes you have [installed Harbor](install.md).

:::{tip}
Run `harbor doctor` first. It checks your credentials and network before anything is
deployed.
:::

## Describe the service

Create `harbor.toml` next to your code:

```toml
[service]
name = "orders"
port = 8080
replicas = 2
```

## Choose a region

| Region     | Location  | Latency from Europe |
|------------|-----------|---------------------|
| `eu-north` | Stockholm | 12 ms               |
| `eu-west`  | Dublin    | 28 ms               |
| `us-east`  | Virginia  | 95 ms               |

## Deploy

1. Log in with `harbor login`.
2. Run `harbor deploy` in the folder.
3. Open the address it prints.

:::{note}
The first deploy builds an image, so it takes a minute or two. Later deploys reuse
it and are done in seconds.
:::

## Next steps

Set {ref}`environment variables <configuration>` for the service, or read how to
[roll back](../guides/rollbacks.md) a deploy that went wrong.
