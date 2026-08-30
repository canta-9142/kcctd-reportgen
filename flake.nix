{
  description = "Development environment for kcctd-reportgen";

  # Keep the Nix-provided browser in sync with package-lock.json's Playwright 1.60.0.
  inputs.nixpkgs.url = "github:NixOS/nixpkgs/d5e64fa9b7e57a36e9a87b06be02acca5e19adbc";

  outputs =
    { nixpkgs, ... }:
    let
      supportedSystems = [
        "aarch64-darwin"
        "aarch64-linux"
        "x86_64-darwin"
        "x86_64-linux"
      ];
      forAllSystems = nixpkgs.lib.genAttrs supportedSystems;
    in
    {
      devShells = forAllSystems (
        system:
        let
          pkgs = import nixpkgs { inherit system; };
          playwrightBrowsers = pkgs.playwright-driver.selectBrowsers {
            withFirefox = false;
            withWebkit = false;
            withFfmpeg = false;
          };
        in
        {
          default = pkgs.mkShellNoCC {
            packages = [
              pkgs.nodejs_22
              playwrightBrowsers
            ];

            env = {
              PLAYWRIGHT_BROWSERS_PATH = "${playwrightBrowsers}";
              PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD = "1";
              FONTCONFIG_FILE = pkgs.makeFontsConf {
                fontDirectories = [ pkgs.noto-fonts-cjk-sans ];
              };
            };
          };
        }
      );

      formatter = forAllSystems (system: nixpkgs.legacyPackages.${system}.nixfmt);
    };
}
