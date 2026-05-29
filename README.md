# MioCraft

A comprehensive knowledge base and blog built with [Astro](https://astro.build/). This project serves as a structured repository for technical articles, focusing on System Design, Software Architecture, and Programming.

## 🚀 Features

- **Blazing Fast**: Built with Astro for optimal performance and static site generation.
- **Structured Content**: Articles are organized into clear, sequential parts (series) and categorized by topics.
- **Topics Covered**:
  - 🖥️ System Design
  - 🏗️ Architecture
  - 💻 Programming
- **Modern UI**: Clean, dark-themed, and responsive interface with interactive accordions for easy navigation.
- **Content Collections**: Leverages Astro's Content Collections for type-safe markdown/MDX rendering.

## 🛠️ Tech Stack

- **Framework**: [Astro](https://astro.build/)
- **Deployment**: [Vercel](https://vercel.com/) (configured with `@astrojs/vercel`)
- **Styling**: Vanilla CSS with CSS Variables

## 💻 Getting Started

Follow these steps to run the project locally.

### Prerequisites
- Node.js (v18 or higher recommended)
- npm (or yarn/pnpm)

### Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/RedAvocado22/MioCraft.git
   cd MioCraft
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Start the development server:
   ```bash
   npm run dev
   ```

4. Open your browser and navigate to `http://localhost:4321`.

## 📦 Scripts

- `npm run dev`: Starts the local development server.
- `npm run build`: Builds the project for production into the `dist/` directory.
- `npm run preview`: Previews the production build locally.
- `npm run import`: Runs the custom script to import articles (`scripts/import-article.mjs`).
- `npm run admin`: Runs the admin script (`scripts/admin.mjs`).

## 📝 License

This project is licensed under the MIT License.
