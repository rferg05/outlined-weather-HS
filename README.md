# outlined-weather-HS
Weather module for Homescreens raspberry pi

Weather with an outline around the text and icons, so it stays readable over photos and busy backgrounds.

## Install

In the Home Screens editor, open the Plugin Store, choose **Install from URL**, and paste:

```
https://github.com/rferg05/outlined-weather-HS/releases/latest/download/outlined-weather.tar.gz
```

This always points at the newest release. Home Screens doesn't check URL-installed plugins for updates on its own, so to update: Plugin Store > **Installed**, then the download icon on Outlined Weather, then **Install**.

## Building

```bash
npm install
npm run build
```

This produces `dist/bundle.js`. To make a release tarball, wrap `manifest.json` and `dist/` in a single `outlined-weather/` folder:

```bash
mkdir -p pkg/outlined-weather/dist
cp manifest.json pkg/outlined-weather/
cp dist/bundle.js dist/bundle.js.map pkg/outlined-weather/dist/
tar -czf outlined-weather-<version>.tar.gz -C pkg outlined-weather
```

Attach it to a GitHub release tagged `v<version>`, along with a copy named `outlined-weather.tar.gz` so the `latest/download` URL above keeps working:

```bash
cp outlined-weather-<version>.tar.gz outlined-weather.tar.gz
gh release create v<version> outlined-weather-<version>.tar.gz outlined-weather.tar.gz --title v<version>
```
