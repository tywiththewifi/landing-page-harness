# The public import service behind the online demo (apps/api/src/public-server.ts):
# a headless browser that reads one site on request and keeps nothing. Runs on
# Hugging Face Spaces (port 7860), Render, Cloud Run or any container host.
FROM mcr.microsoft.com/playwright:v1.64.1-noble

ENV CI=true NODE_ENV=production PORT=7860
RUN npm install -g pnpm@10.28.0

WORKDIR /app
COPY . .
# The image already has Playwright's browsers; the install only adds node packages.
RUN pnpm install --frozen-lockfile && chmod -R a+rX /app

# Hosts like Hugging Face run the container as an unprivileged user.
USER pwuser
EXPOSE 7860
CMD ["pnpm", "--filter", "@lph/api", "start:public"]
