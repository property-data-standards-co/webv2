import { defineConfig } from 'astro/config';
import tailwind from "@astrojs/tailwind";

// https://astro.build/config
export default defineConfig({
    site: 'https://propdata.org.uk',
    base: '/',
    output: 'static',
    integrations: [
        tailwind({
            applyBaseStyles: false
        })
    ],
    build: {
        assets: '_assets'
    }
});
