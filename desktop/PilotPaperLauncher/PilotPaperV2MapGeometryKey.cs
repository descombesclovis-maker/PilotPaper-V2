namespace PilotPaperLauncher;

internal sealed partial class PilotPaperV2Window
{
    protected override void OnShown(EventArgs e)
    {
        EnsureMapGeometryKey();
        base.OnShown(e);
    }

    private void EnsureMapGeometryKey()
    {
        var canonical = ReadLocalVar("GOOGLE_SOLAR_API_KEY");
        if (!string.IsNullOrWhiteSpace(canonical)) return;

        // Reuse an existing compatible key from older PilotPaper/QEH setups so
        // an upgrade does not unnecessarily ask the user for the same secret.
        var migrated = ReadLocalVar("SOLAR_API_KEY") ?? ReadLocalVar("GOOGLE_MAPS_API_KEY");
        if (!string.IsNullOrWhiteSpace(migrated))
        {
            WriteLocalVar("GOOGLE_SOLAR_API_KEY", migrated.Trim());
            AppendLog("Map geometry credential migrated from an existing local key.");
            return;
        }

        var key = PromptForLocalSecret(
            "PilotPaper V2 — Moteur cartographique",
            "Saisissez une clé Google Maps Platform avec Solar API activée. Elle permet à PilotPaper de récupérer le DSM et l’orthophoto métrique nécessaires aux pans et aux insertions. La clé reste uniquement sur ce poste.");

        if (string.IsNullOrWhiteSpace(key))
        {
            AppendLog("Map geometry credential was not configured; independent geometry fallbacks will be tried.");
            return;
        }
        if (key.Length < 20 || key.Contains('\n') || key.Contains('\r'))
        {
            MessageBox.Show(
                this,
                "La clé du moteur cartographique n'a pas un format valide. PilotPaper essaiera les autres sources géométriques, mais certaines DP pourront être indisponibles.",
                "PilotPaper V2",
                MessageBoxButtons.OK,
                MessageBoxIcon.Warning);
            return;
        }

        WriteLocalVar("GOOGLE_SOLAR_API_KEY", key.Trim());
        AppendLog("Map geometry credential saved locally for the Site Twin pipeline.");
    }
}
