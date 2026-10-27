# Changelog

All notable changes to this project will be documented in this file. See [standard-version](https://github.com/conventional-changelog/standard-version) for commit guidelines.

## [2.1.0](https://github.com/CodySwannGT/aws-soc2-setup/compare/v2.0.0...v2.1.0) (2026-10-27)


### Features

* **scp:** add resource-scoped --exempt-user exemption to deny-iam-users ([ec248cd](https://github.com/CodySwannGT/aws-soc2-setup/commit/ec248cd0620088f2f8fee1e3a1af9d1a95e4876f)), closes [CodySwannGT/aws-soc2-setup#33](https://github.com/CodySwannGT/aws-soc2-setup/issues/33) [CodySwannGT/aws-soc2-setup#33](https://github.com/CodySwannGT/aws-soc2-setup/issues/33)


### Bug Fixes

* **scp:** tighten scoped-exemption validation and keep exempt-arn principals whole ([fe90c64](https://github.com/CodySwannGT/aws-soc2-setup/commit/fe90c64de9c2841cc14a3276827aa391db98ffae)), closes [#34](https://github.com/CodySwannGT/aws-soc2-setup/issues/34) [CodySwannGT/aws-soc2-setup#33](https://github.com/CodySwannGT/aws-soc2-setup/issues/33) [CodySwannGT/aws-soc2-setup#33](https://github.com/CodySwannGT/aws-soc2-setup/issues/33)

## [2.0.0](https://github.com/CodySwannGT/aws-soc2-setup/compare/v1.1.5...v2.0.0) (2026-10-25)


### ⚠ BREAKING CHANGES

* **sso:** `sso group` / `sso assign` use `-s` instead of `-r` as the
short form of `--permission-set`. `-r` now always means `--region`.

🤖 Generated with Claude Code

Co-Authored-By: Claude
* **controltower:** `controltower provision-account` no longer falls back to the
account root email for the SSO user. Callers that are not using an IAM
Identity Center session must pass `--sso-email`. Passing the account's own
root email as `--sso-email` is now rejected.

🤖 Generated with Claude Code

Co-Authored-By: Claude

### Bug Fixes

* address review on root, backup, and Config-rule controls ([985b7ad](https://github.com/CodySwannGT/aws-soc2-setup/commit/985b7ada98eda1124f60d5e9c6c174f43fd38854)), closes [CodySwannGT/aws-soc2-setup#31](https://github.com/CodySwannGT/aws-soc2-setup/issues/31)
* **backup:** register --admin-account as delegated admin; state scope ([45100f0](https://github.com/CodySwannGT/aws-soc2-setup/commit/45100f03494fddc33d251f2c23daed7aed7bfc52)), closes [CodySwannGT/aws-soc2-setup#31](https://github.com/CodySwannGT/aws-soc2-setup/issues/31)
* **cli:** explain and survive npm exec swallowing --yes/--dry-run ([ccc5cc7](https://github.com/CodySwannGT/aws-soc2-setup/commit/ccc5cc787114235b72eeab82fbe051e525ed91b9)), closes [CodySwannGT/aws-soc2-setup#31](https://github.com/CodySwannGT/aws-soc2-setup/issues/31)
* **controltower:** stop defaulting the Account Factory SSO user to root ([9678180](https://github.com/CodySwannGT/aws-soc2-setup/commit/967818039dfaca5b24f1ce58f786678ba5de9039)), closes [CodySwannGT/aws-soc2-setup#31](https://github.com/CodySwannGT/aws-soc2-setup/issues/31)
* **controltower:** use real catalog controls and classify enable outcomes ([bd8019d](https://github.com/CodySwannGT/aws-soc2-setup/commit/bd8019dc4568088348b60c5bbbadbe3ca2942a25)), closes [CodySwannGT/aws-soc2-setup#31](https://github.com/CodySwannGT/aws-soc2-setup/issues/31)
* **root:** report SCP-restricted root concisely and show org features ([7f864c6](https://github.com/CodySwannGT/aws-soc2-setup/commit/7f864c66c253f4e48122f0563614d222fcb5474f)), closes [CodySwannGT/aws-soc2-setup#31](https://github.com/CodySwannGT/aws-soc2-setup/issues/31)
* **scp:** use topic-scoped SNS actions in the alert topic policy ([0850fb2](https://github.com/CodySwannGT/aws-soc2-setup/commit/0850fb25fefd9f9a672cb1f112530f1c18b67a88)), closes [CodySwannGT/aws-soc2-setup#31](https://github.com/CodySwannGT/aws-soc2-setup/issues/31)
* **security:** retry AWS Config setup while a new IAM role propagates ([2438df0](https://github.com/CodySwannGT/aws-soc2-setup/commit/2438df05ec125d54d2e070716413d03445534bf9)), closes [CodySwannGT/aws-soc2-setup#31](https://github.com/CodySwannGT/aws-soc2-setup/issues/31)
* **security:** wait for Inspector ECR scanning before updating rescan ([1282f5b](https://github.com/CodySwannGT/aws-soc2-setup/commit/1282f5bc5a14be9c9d1004fb74d480e99aab6e13)), closes [CodySwannGT/aws-soc2-setup#31](https://github.com/CodySwannGT/aws-soc2-setup/issues/31)
* **sso:** stop --permission-set shadowing the global -r/--region ([2a36114](https://github.com/CodySwannGT/aws-soc2-setup/commit/2a3611426a715c2485c69d972ad888d1965816ae)), closes [CodySwannGT/aws-soc2-setup#31](https://github.com/CodySwannGT/aws-soc2-setup/issues/31)


### Documentation

* document new behaviours, ordering, and the CT admin user ([9b1488d](https://github.com/CodySwannGT/aws-soc2-setup/commit/9b1488de3d103205a1917b73561e6ecc2d3271c7)), closes [CodySwannGT/aws-soc2-setup#31](https://github.com/CodySwannGT/aws-soc2-setup/issues/31)

### [1.1.5](https://github.com/CodySwannGT/aws-soc2-setup/compare/v1.1.4...v1.1.5) (2026-10-04)


### Bug Fixes

* point package types at the emitted declaration file ([6c31f4e](https://github.com/CodySwannGT/aws-soc2-setup/commit/6c31f4eab73945bd7c53877978cd85f6e3186d13)), closes [CodySwannGT/aws-soc2-setup#29](https://github.com/CodySwannGT/aws-soc2-setup/issues/29)
* **sso:** read set-start-url's profile from the global --profile ([5d906e5](https://github.com/CodySwannGT/aws-soc2-setup/commit/5d906e5d44a8b9cf6b6692bc1375bf3211d10a33)), closes [CodySwannGT/aws-soc2-setup#29](https://github.com/CodySwannGT/aws-soc2-setup/issues/29)

### [1.1.4](https://github.com/CodySwannGT/aws-soc2-setup/compare/v1.1.3...v1.1.4) (2026-07-16)

### [1.1.3](https://github.com/CodySwannGT/aws-soc2-setup/compare/v1.1.2...v1.1.3) (2026-07-11)


### Bug Fixes

* remove dangling $vite override reference ([d4d9a86](https://github.com/CodySwannGT/aws-soc2-setup/commit/d4d9a860a55747bb4470ab170d535e2b582784ab))

### [1.1.2](https://github.com/CodySwannGT/aws-soc2-setup/compare/v1.1.1...v1.1.2) (2026-07-11)

### [1.1.1](https://github.com/CodySwannGT/aws-soc2-setup/compare/v1.1.0...v1.1.1) (2026-07-11)

## 1.1.0 (2026-07-11)


### Features

* add dynamic setup checklist and update script ([4c395d7](https://github.com/CodySwannGT/aws-soc2-setup/commit/4c395d7ef5c6a7a627ac08b506dd04cc0339a774))
* add scp command group for org-wide iam credential lockdown ([aae31dd](https://github.com/CodySwannGT/aws-soc2-setup/commit/aae31ddec425dd9da84f0fcc5e3868116e48bca6))
* **controltower:** add register-ou via EnableBaseline ([12daa13](https://github.com/CodySwannGT/aws-soc2-setup/commit/12daa13cc77bded305011706a9388bc55211c0bd))
* **controltower:** script CreateOrganization with FeatureSet ALL ([7284761](https://github.com/CodySwannGT/aws-soc2-setup/commit/7284761aae73b142f4cfbb7cb7491823fc4b8d13))
* convert AWS SOC 2 bash suite to a typed TypeScript CLI ([35083e0](https://github.com/CodySwannGT/aws-soc2-setup/commit/35083e0f6bbd265994684bd1e66f7adceb0ab64c))
* enhance Control Tower setup with improved security and UX ([756364f](https://github.com/CodySwannGT/aws-soc2-setup/commit/756364fcd6654c78ad7b9f214b18dd3f980a88ca))
* initialize project configuration and AI assistant setup ([9d4afc0](https://github.com/CodySwannGT/aws-soc2-setup/commit/9d4afc0d7ec754ed124c80c8c4bc53dcbdf35bbb))
* **security:** add Config Conformance Packs command ([1e7f491](https://github.com/CodySwannGT/aws-soc2-setup/commit/1e7f4914c37958ee83f04eca9e240d41bd73fc98))
* **wiki:** scaffold LLM Wiki kernel and seed staff roster ([7f30f69](https://github.com/CodySwannGT/aws-soc2-setup/commit/7f30f69f2af479d1c15f9608a36838e538660a8e))


### Bug Fixes

* address parity gaps found by the conversion-evaluation team ([389a8e8](https://github.com/CodySwannGT/aws-soc2-setup/commit/389a8e8c881161c146516ba603d56598449400ae))
* **controltower:** address register-ou CodeRabbit review ([a1c4c59](https://github.com/CodySwannGT/aws-soc2-setup/commit/a1c4c598a3191b3f01a912fd97ec287e8138b058))
* **controltower:** default register-ou baseline to 5.0 ([025fae0](https://github.com/CodySwannGT/aws-soc2-setup/commit/025fae0f6c1c1df408b402272d077739da4f8bb2))
* create alert resources in us-east-1 regardless of --region ([7adc192](https://github.com/CodySwannGT/aws-soc2-setup/commit/7adc1926d7a7cd9933596626adeca4a5ceff1959))
* **root:** tolerate SCP denials during member root cleanup ([7d9f07a](https://github.com/CodySwannGT/aws-soc2-setup/commit/7d9f07ab0271bc5c403b4b4584e2ab9d1f4fb900))
* **security:** detect Audit Manager maintenance mode ([d52b894](https://github.com/CodySwannGT/aws-soc2-setup/commit/d52b89491cbfb6d82024f504bd125ce372c7db8c))


### Documentation

* add AI Coding Assistant integration section ([9c8eee4](https://github.com/CodySwannGT/aws-soc2-setup/commit/9c8eee4778535ce6118952d5c30032a9a15dc520))
* align published story with TypeScript CLI and flesh out status ([12e2c17](https://github.com/CodySwannGT/aws-soc2-setup/commit/12e2c174420cc854980ea20507334100410e2851))
* **wiki:** ingest git history and roles roster ([7416f52](https://github.com/CodySwannGT/aws-soc2-setup/commit/7416f5254d6575afcc91608692595c6d22aac068))

# Changelog

All notable changes to this project will be documented in this file. See
[standard-version](https://github.com/conventional-changelog/standard-version)
for commit guidelines.
