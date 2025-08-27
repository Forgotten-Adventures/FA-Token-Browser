# Change Log

All notable changes to this project will be documented in this file.

## [0.9.5] - 2025-08-28

### Added

* Local-only mode implementation (issue #13)
* Smart Deduplication - Automatically hide duplicate tokens (local/cloud) while preferring local versions
* New folder selection dialog for managing multiple local token folders
* Enhanced descriptions and refined UI elements
* Support for Foundryborne Daggerheart game system (issue #11)
* Support for Black Flag game system (issue #16)
* Support for DSA5/The Dark Eye
* Adaptive theming: Token Browser now follows Foundry's Applications Light/Dark theme
  * Scoped CSS variables to prevent system style conflicts
  * Variants panel inherits theme
  * Live updates when changing theme in settings
* Better readability in systems with light-only themes


## [0.9.4] - 2025-08-03

### Fixed

* Issue #9: CSS scoping improvements for better module isolation
* Issue #10: Enhanced CSS scoping to prevent style conflicts
* Issue #7: Potential bug fixes and improvements

## [0.9.3] - 2025-07-28

### Fixed

* Issue #1: Bug fixes and improvements for token browser functionality
* Issue #3: Bug fixes and improvements for drag-and-drop operations
* Issue #5: Bug fixes and improvements for search and filtering

## [0.9.2] - 2025-07-21

Initial Public Release

### Added

* Wildcard Tokens feature for randomized token appearances
* Enhanced token drag-and-drop functionality with wildcard token support
* Users can now select random color variants

### Changed

* Updated README documentation

## [0.9.0] - 2025-07-14

### Added

* Hide locked tokens feature with UI checkbox
* Enhanced search functionality to filter out locked tokens
* Authentication status-based UI display for hide locked checkbox

### Changed

* Enhanced event management for new filter handling
* Updated CSS for checkbox styling
* Improved visual consistency across token browser
* Adjusted font colors and removed deprecated styles

### Fixed

* Drag-and-drop logic to prevent dragging of locked tokens
* Improved caching mechanisms
* Enhanced search engine sorting functionality

### Removed

* Removed debug_cached_tokens.js
* Removed token-browser-plan.md

## [0.8.6] - 2025-07-12

### Added

* Sorting functionality for token display
* Sort selector to the UI

### Changed

* Enhanced event management with sort handler registration
* Improved layout CSS

## [0.8.5] - 2025-07-11

### Added

* Global drag state management for improved reliability
* Cleanup methods for actor highlights during drag events

### Changed

* Enhanced drag-and-drop functionality in the token browser

## [0.8.4] - 2025-07-09

### Added

* Destroy methods for cleanup in various services

### Changed

* Enhanced event management and token handling
* Improved performance and reliability

### Fixed

* Memory leak fixes across multiple components

## [0.8.3] - 2025-07-08

### Changed

* Refactored token browser instance retrieval for improved performance
* Removed cache deletion as deleting files is not supported through Foundry directly

### Removed

* fa-token-browser.zip

## [0.8.2] - 2025-07-08

### Changed

* Modified token drag-and-drop logic for improved handling of drag events
* Updated fa-token-browser.zip to the latest version

## [0.8.1] - 2025-07-05

### Changed

* Enhanced search engine for improved token display messaging
* Adjusted template for dynamic token labeling based on main color filter setting

## [0.8.0] - 2025-07-04

### Added

* Main color filter for token variants
* Enhanced event manager with new handlers

### Changed

* Improved UI/UX with adjusted styles and templates

### Removed

* .gitignore

## [0.6.6] - 2025-07-02

### Fixed

* Local tokens fix
* Console warning mute for Forge VTT
* Patreon multi refresh on auth fix
* Forge CORS fix
* Download link fix

### Changed

* ForgeVTT fixes and optimizations
* Small FoundryVTT optimization
* Updated zip to latest version
