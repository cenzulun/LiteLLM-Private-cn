import i18n, { type InitOptions } from "i18next";
import { initReactI18next } from "react-i18next";

import { registerFormats } from "./formats";
import en from "./locales/en.json";
import zh from "./locales/zh-CN.json";
import moment from "moment";
import "moment/locale/zh-cn";
import dayjs from "dayjs";
import "dayjs/locale/zh-cn";

moment.locale("zh-cn");
dayjs.locale("zh-cn");

declare module "i18next" {
  interface CustomTypeOptions {
    defaultNS: "translation";
    resources: { translation: typeof en };
  }
}

const options: InitOptions = {
  lng: "zh-CN",
  fallbackLng: "zh-CN",
  interpolation: { escapeValue: false },
  resources: { "zh-CN": { translation: zh } },
  initAsync: false,
};

void i18n.use(initReactI18next).init(options);

if (i18n.services.formatter) registerFormats(i18n.services.formatter);

export default i18n;
