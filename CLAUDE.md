# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

### Development

- `bun install` - Install dependencies
- `bun run index.ts` - Run the CLI application
- `bun run format` - Format code using Prettier with import organization

### Quality Assurance

- ESLint is configured with TypeScript support and perfectionist plugin for sorting
- Prettier is configured with import organization and package.json sorting
- Pre-commit hooks run lint-staged to format all files before commits

## Architecture

This is a CLI tool that generates AI-powered commit messages using Google's Gemini model. The application analyzes git repository state and creates conventional commit messages.

### Core Components

**index.ts**: Main entry point containing the CLI logic, git analysis, and AI interaction flow. Currently has the AI generation code commented out (lines 135-230).

**constants.ts**: Contains the system and user instruction prompts for the AI model, plus Zod schema for response validation. The system instruction defines the AI's role as a git commit expert following Conventional Commits specification.

**utils.ts**: Utility functions for text formatting, token counting categorization, and change count categorization with visual feedback.

**clack.ts**: Wrapper around @clack/prompts providing consistent UI experience with support for silent and force modes.

### Key Features

- Token counting with user warnings for expensive operations
- Interactive confirmation prompts with force/silent mode support
- Git repository analysis (status, diff, diff summary)
- Conventional Commits specification compliance
- Visual feedback with colors and emojis for different states

The application follows a pattern of: analyze repository → count tokens → get user confirmation → generate commits → execute commits. The AI generation is currently disabled in the codebase.
