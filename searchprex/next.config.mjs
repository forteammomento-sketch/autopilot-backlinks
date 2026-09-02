/** @type {import('next').NextConfig} */
export default {
  typedRoutes: false,

  /**
   * `src/` is a portable ESM library: its internal imports carry `.js`
   * extensions so it runs unbundled under Node. Webpack does not remap those to
   * the `.ts` files on disk by default, so teach it to — rather than stripping
   * the extensions and making the library non-portable to serve the app.
   */
  webpack: (config) => {
    config.resolve.extensionAlias = {
      '.js': ['.ts', '.tsx', '.js'],
      '.mjs': ['.mts', '.mjs'],
    };
    return config;
  },
};
