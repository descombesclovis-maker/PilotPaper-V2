using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace PilotPaperLauncher;

internal sealed record GeometryEngineSession(string Token, int OrgId, int UserId);

internal static class GeometryEngineCredentials
{
    private static readonly byte[] Entropy = Encoding.UTF8.GetBytes("PilotPaper-V2-GeometryEngine-v1");

    private sealed record StoredCredential(string Token, int OrgId, int UserId, int SchemaVersion = 1);

    private static string CredentialPath => Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "PilotPaper",
        "V2",
        "geometry-engine.bin");

    internal static Task<GeometryEngineSession?> EnsureAsync(Form owner, Action<string> log)
    {
        _ = owner;
        return Task.FromResult(TryLoad(log));
    }

    internal static GeometryEngineSession? TryLoad(Action<string> log)
    {
        try
        {
            if (!File.Exists(CredentialPath))
            {
                log("Geometry engine protected credential not found; fallback remains active.");
                return null;
            }

            var encrypted = File.ReadAllBytes(CredentialPath);
            var plain = ProtectedData.Unprotect(encrypted, Entropy, DataProtectionScope.CurrentUser);
            try
            {
                var stored = JsonSerializer.Deserialize<StoredCredential>(plain);
                if (stored is null || string.IsNullOrWhiteSpace(stored.Token) || stored.OrgId < 1 || stored.UserId < 1)
                {
                    log("Geometry engine protected credential is incomplete; fallback remains active.");
                    return null;
                }
                return new GeometryEngineSession(stored.Token, stored.OrgId, stored.UserId);
            }
            finally
            {
                CryptographicOperations.ZeroMemory(plain);
            }
        }
        catch (Exception ex)
        {
            log($"Geometry engine protected credential could not be read: {ex.Message}");
            return null;
        }
    }
}
