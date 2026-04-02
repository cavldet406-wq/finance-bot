import { config } from "./config.js";
import {
  DEFAULT_CATEGORY_ROWS,
  DEFAULT_PNL_GROUPS,
  getSheetsClient,
  LEGACY_SHEET_NAMES,
  SHEET_NAMES
} from "./sheets.js";

const SHEET_TITLES = Object.values(SHEET_NAMES);

async function getSpreadsheet(sheets) {
  const response = await sheets.spreadsheets.get({
    spreadsheetId: config.spreadsheetId
  });

  return response.data;
}

function getSheetMap(spreadsheet) {
  return new Map(
    (spreadsheet.sheets || []).map((sheet) => [sheet.properties.title, sheet.properties])
  );
}

function getFormulaSeparator(spreadsheet) {
  const locale = spreadsheet.properties?.locale || "";

  return /(^|_)(ru|uk|de|fr|it|es|pt|pl|tr|cs|sk|hu|nl|sv|da|fi|no)/i.test(locale)
    ? ";"
    : ",";
}

function sheetRef(title) {
  return /[^A-Za-z0-9_]/.test(title) ? `'${title}'` : title;
}

function joinArgs(separator, ...parts) {
  return parts.join(separator);
}

const VALUE_TRANSLATIONS = new Map([
  ["income", "Доход"],
  ["expense", "Расход"],
  ["Revenue", "Выручка"],
  ["COGS", "Себестоимость"],
  ["Payroll", "ФОТ"],
  ["Taxes", "Налоги"],
  ["Marketing", "Маркетинг"],
  ["Software", "Софт"],
  ["Contractors", "Подрядчики"],
  ["Rent", "Аренда"],
  ["Other Expense", "Прочие расходы"],
  ["OPEX", "Операционные расходы"],
  ["RUB", "₽"],
  ["telegram", "Телеграм"]
]);

async function ensureSheets(sheets, spreadsheet) {
  const sheetMap = getSheetMap(spreadsheet);
  const requests = [];
  const resolvedTitles = new Set(sheetMap.keys());
  const renamePairs = [
    [LEGACY_SHEET_NAMES.operations, SHEET_NAMES.operations],
    [LEGACY_SHEET_NAMES.dds, SHEET_NAMES.dds],
    [LEGACY_SHEET_NAMES.dashboard, SHEET_NAMES.dashboard]
  ];

  for (const [legacyTitle, newTitle] of renamePairs) {
    if (legacyTitle !== newTitle && sheetMap.has(legacyTitle) && !sheetMap.has(newTitle)) {
      requests.push({
        updateSheetProperties: {
          properties: {
            sheetId: sheetMap.get(legacyTitle).sheetId,
            title: newTitle
          },
          fields: "title"
        }
      });
      resolvedTitles.delete(legacyTitle);
      resolvedTitles.add(newTitle);
    }
  }

  for (const title of SHEET_TITLES) {
    if (!resolvedTitles.has(title)) {
      requests.push({
        addSheet: {
          properties: {
            title
          }
        }
      });
      resolvedTitles.add(title);
    }
  }

  if (requests.length) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: config.spreadsheetId,
      requestBody: { requests }
    });
  }
}

async function writeBaseTables(sheets, spreadsheet) {
  const separator = getFormulaSeparator(spreadsheet);
  const operationsSheet = sheetRef(SHEET_NAMES.operations);
  const categoriesSheet = sheetRef(SHEET_NAMES.categories);
  const ddsSheet = sheetRef(SHEET_NAMES.dds);
  const pnlSheet = sheetRef(SHEET_NAMES.pnl);

  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: config.spreadsheetId,
    valueInputOption: "USER_ENTERED",
    requestBody: {
      data: [
        {
          range: `${SHEET_NAMES.categories}!A1:F20`,
          values: [
            ["Категория", "Группа PNL", "Описание", "Активна", "", "Группы PNL"],
            ...DEFAULT_CATEGORY_ROWS,
            ["", "", "", "", "", DEFAULT_PNL_GROUPS[0]],
            ["", "", "", "", "", DEFAULT_PNL_GROUPS[1]],
            ["", "", "", "", "", DEFAULT_PNL_GROUPS[2]]
          ]
        },
        {
          range: `${SHEET_NAMES.operations}!A1:O1`,
          values: [
            [
              "Создано",
              "Дата операции",
              "Месяц",
              "Тип",
              "Категория",
              "Группа PNL",
              "Описание",
              "Сумма",
              "Сумма со знаком",
              "Валюта",
              "Источник",
              "Исходный текст",
              "Пользователь",
              "Чат",
              "Месяц текстом"
            ]
          ]
        },
        {
          range: `${SHEET_NAMES.dds}!A1:D2`,
          values: [
            ["Месяц", "Поступления", "Выплаты", "Чистый денежный поток"],
            [
              `=SORT(UNIQUE(FILTER(${joinArgs(separator, `${operationsSheet}!C2:C`, `${operationsSheet}!C2:C<>""`)})))`,
              `=ARRAYFORMULA(IF(${joinArgs(separator, 'A2:A=""', '""', `SUMIFS(${joinArgs(separator, `${operationsSheet}!I:I`, `${operationsSheet}!C:C`, "A2:A", `${operationsSheet}!D:D`, '"Доход"')})`)}))`,
              `=ARRAYFORMULA(IF(${joinArgs(separator, 'A2:A=""', '""', `-SUMIFS(${joinArgs(separator, `${operationsSheet}!I:I`, `${operationsSheet}!C:C`, "A2:A", `${operationsSheet}!D:D`, '"Расход"')})`)}))`,
              `=ARRAYFORMULA(IF(${joinArgs(separator, 'A2:A=""', '""', "B2:B-C2:C")}))`
            ]
          ]
        },
        {
          range: `${SHEET_NAMES.pnl}!A1:F2`,
          values: [
            ["Месяц", "Выручка", "Себестоимость", "Валовая прибыль", "Операционные расходы", "Чистая прибыль"],
            [
              `=SORT(UNIQUE(FILTER(${joinArgs(separator, `${operationsSheet}!C2:C`, `${operationsSheet}!C2:C<>""`)})))`,
              `=ARRAYFORMULA(IF(${joinArgs(separator, 'A2:A=""', '""', `SUMIFS(${joinArgs(separator, `${operationsSheet}!I:I`, `${operationsSheet}!C:C`, "A2:A", `${operationsSheet}!F:F`, '"Выручка"')})`)}))`,
              `=ARRAYFORMULA(IF(${joinArgs(separator, 'A2:A=""', '""', `-SUMIFS(${joinArgs(separator, `${operationsSheet}!I:I`, `${operationsSheet}!C:C`, "A2:A", `${operationsSheet}!F:F`, '"Себестоимость"')})`)}))`,
              `=ARRAYFORMULA(IF(${joinArgs(separator, 'A2:A=""', '""', "B2:B-C2:C")}))`,
              `=ARRAYFORMULA(IF(${joinArgs(separator, 'A2:A=""', '""', `-SUMIFS(${joinArgs(separator, `${operationsSheet}!I:I`, `${operationsSheet}!C:C`, "A2:A", `${operationsSheet}!F:F`, '"Операционные расходы"')})`)}))`,
              `=ARRAYFORMULA(IF(${joinArgs(separator, 'A2:A=""', '""', "D2:D-E2:E")}))`
            ]
          ]
        },
        {
          range: `${SHEET_NAMES.dashboard}!A1:B6`,
          values: [
            ["Финансовый дашборд", ""],
            ["Показатель", "Значение"],
            ["Выручка всего", `=SUM(${pnlSheet}!B2:B)`],
            ["Себестоимость всего", `=SUM(${pnlSheet}!C2:C)`],
            ["Операционные расходы всего", `=SUM(${pnlSheet}!E2:E)`],
            ["Чистая прибыль", `=SUM(${pnlSheet}!F2:F)`]
          ]
        },
        {
          range: `${SHEET_NAMES.dashboard}!D2:E7`,
          values: [
            ["Текущий месяц", `=MAX(${pnlSheet}!A2:A)`],
            ["Выручка месяца", `=XLOOKUP(E2${separator}${pnlSheet}!A2:A${separator}${pnlSheet}!B2:B${separator}0)`],
            ["Себестоимость месяца", `=XLOOKUP(E2${separator}${pnlSheet}!A2:A${separator}${pnlSheet}!C2:C${separator}0)`],
            ["Опер. расходы месяца", `=XLOOKUP(E2${separator}${pnlSheet}!A2:A${separator}${pnlSheet}!E2:E${separator}0)`],
            ["Чистая прибыль месяца", `=XLOOKUP(E2${separator}${pnlSheet}!A2:A${separator}${pnlSheet}!F2:F${separator}0)`],
            ["Чистый денежный поток", `=XLOOKUP(E2${separator}${ddsSheet}!A2:A${separator}${ddsSheet}!D2:D${separator}0)`]
          ]
        },
        {
          range: `${SHEET_NAMES.dashboard}!G2:H12`,
          values: [
            ["Топ категорий расходов", "Сумма"],
            [
              `=QUERY(${operationsSheet}!D2:H${separator}"select Col2, sum(Col5) where Col1 = 'Расход' group by Col2 order by sum(Col5) desc label Col2 'Категория', sum(Col5) 'Сумма'"${separator}0)`,
              ""
            ]
          ]
        }
      ]
    }
  });
}

async function migrateExistingTransactions(sheets) {
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: config.spreadsheetId,
    range: `${SHEET_NAMES.operations}!A2:O`
  });

  const rows = response.data.values || [];

  if (!rows.length) {
    return;
  }

  const migratedRows = rows.map((row) =>
    row.map((cell, index) => {
      if ([3, 4, 5, 9, 10].includes(index)) {
        return VALUE_TRANSLATIONS.get(cell) || cell;
      }

      return cell;
    })
  ).map((row) => {
    const padded = [...row];

    while (padded.length < 15) {
      padded.push("");
    }

    if (!padded[14] && padded[2]) {
      const date = new Date(padded[2]);

      if (!Number.isNaN(date.getTime())) {
        padded[14] = new Intl.DateTimeFormat("ru-RU", {
          month: "long",
          year: "numeric",
          timeZone: "UTC"
        }).format(date);
      }
    }

    return padded;
  });

  await sheets.spreadsheets.values.update({
    spreadsheetId: config.spreadsheetId,
    range: `${SHEET_NAMES.operations}!A2:O${rows.length + 1}`,
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values: migratedRows
    }
  });
}

async function applyFormattingAndCharts(sheets) {
  const spreadsheet = await getSpreadsheet(sheets);
  const sheetMap = getSheetMap(spreadsheet);
  const transactionsSheetId = sheetMap.get(SHEET_NAMES.operations).sheetId;
  const categoriesSheetId = sheetMap.get(SHEET_NAMES.categories).sheetId;
  const ddsSheetId = sheetMap.get(SHEET_NAMES.dds).sheetId;
  const pnlSheetId = sheetMap.get(SHEET_NAMES.pnl).sheetId;
  const dashboardSheetId = sheetMap.get(SHEET_NAMES.dashboard).sheetId;
  const existingChartRequests = (spreadsheet.sheets || [])
    .flatMap((sheet) => sheet.charts || [])
    .map((chart) => ({
      deleteEmbeddedObject: {
        objectId: chart.chartId
      }
    }));

  const requests = [
    ...existingChartRequests,
    {
      repeatCell: {
        range: {
          sheetId: categoriesSheetId,
          startRowIndex: 0,
          endRowIndex: 1
        },
        cell: {
          userEnteredFormat: {
            textFormat: { bold: true },
            backgroundColor: { red: 0.95, green: 0.93, blue: 0.86 }
          }
        },
        fields: "userEnteredFormat(textFormat,backgroundColor)"
      }
    },
    {
      repeatCell: {
        range: {
          sheetId: transactionsSheetId,
          startRowIndex: 0,
          endRowIndex: 1
        },
        cell: {
          userEnteredFormat: {
            textFormat: { bold: true },
            backgroundColor: { red: 0.9, green: 0.94, blue: 0.98 }
          }
        },
        fields: "userEnteredFormat(textFormat,backgroundColor)"
      }
    },
    {
      repeatCell: {
        range: {
          sheetId: ddsSheetId,
          startRowIndex: 0,
          endRowIndex: 1
        },
        cell: {
          userEnteredFormat: {
            textFormat: { bold: true },
            backgroundColor: { red: 0.89, green: 0.96, blue: 0.9 }
          }
        },
        fields: "userEnteredFormat(textFormat,backgroundColor)"
      }
    },
    {
      repeatCell: {
        range: {
          sheetId: pnlSheetId,
          startRowIndex: 0,
          endRowIndex: 1
        },
        cell: {
          userEnteredFormat: {
            textFormat: { bold: true },
            backgroundColor: { red: 0.99, green: 0.94, blue: 0.86 }
          }
        },
        fields: "userEnteredFormat(textFormat,backgroundColor)"
      }
    },
    {
      repeatCell: {
        range: {
          sheetId: transactionsSheetId,
          startColumnIndex: 1,
          endColumnIndex: 2,
          startRowIndex: 1
        },
        cell: {
          userEnteredFormat: {
            numberFormat: {
              type: "DATE",
              pattern: "dd mmmm yyyy"
            }
          }
        },
        fields: "userEnteredFormat.numberFormat"
      }
    },
    {
      repeatCell: {
        range: {
          sheetId: transactionsSheetId,
          startColumnIndex: 2,
          endColumnIndex: 3,
          startRowIndex: 1
        },
        cell: {
          userEnteredFormat: {
            numberFormat: {
              type: "DATE",
              pattern: "mmmm yyyy"
            }
          }
        },
        fields: "userEnteredFormat.numberFormat"
      }
    },
    {
      repeatCell: {
        range: {
          sheetId: transactionsSheetId,
          startColumnIndex: 7,
          endColumnIndex: 10,
          startRowIndex: 1
        },
        cell: {
          userEnteredFormat: {
            numberFormat: {
              type: "NUMBER",
              pattern: "#,##0.00"
            }
          }
        },
        fields: "userEnteredFormat.numberFormat"
      }
    },
    {
      updateSheetProperties: {
        properties: {
          sheetId: categoriesSheetId,
          gridProperties: {
            frozenRowCount: 1
          },
          tabColor: { red: 0.94, green: 0.76, blue: 0.33 }
        },
        fields: "gridProperties.frozenRowCount,tabColor"
      }
    },
    {
      updateSheetProperties: {
        properties: {
          sheetId: transactionsSheetId,
          gridProperties: {
            frozenRowCount: 1
          },
          tabColor: { red: 0.4, green: 0.67, blue: 0.9 }
        },
        fields: "gridProperties.frozenRowCount,tabColor"
      }
    },
    {
      updateSheetProperties: {
        properties: {
          sheetId: ddsSheetId,
          gridProperties: {
            frozenRowCount: 1
          },
          tabColor: { red: 0.42, green: 0.73, blue: 0.53 }
        },
        fields: "gridProperties.frozenRowCount,tabColor"
      }
    },
    {
      updateSheetProperties: {
        properties: {
          sheetId: pnlSheetId,
          gridProperties: {
            frozenRowCount: 1
          },
          tabColor: { red: 0.93, green: 0.63, blue: 0.28 }
        },
        fields: "gridProperties.frozenRowCount,tabColor"
      }
    },
    {
      updateSheetProperties: {
        properties: {
          sheetId: dashboardSheetId,
          tabColor: { red: 0.2, green: 0.58, blue: 0.86 }
        },
        fields: "tabColor"
      }
    },
    {
      setDataValidation: {
        range: {
          sheetId: transactionsSheetId,
          startRowIndex: 1,
          startColumnIndex: 3,
          endColumnIndex: 4
        },
        rule: {
          condition: {
            type: "ONE_OF_LIST",
            values: [{ userEnteredValue: "Доход" }, { userEnteredValue: "Расход" }]
          },
          showCustomUi: true,
          strict: false
        }
      }
    },
    {
      setDataValidation: {
        range: {
          sheetId: transactionsSheetId,
          startRowIndex: 1,
          startColumnIndex: 4,
          endColumnIndex: 5
        },
        rule: {
          condition: {
            type: "ONE_OF_RANGE",
            values: [{ userEnteredValue: `=${sheetRef(SHEET_NAMES.categories)}!A2:A200` }]
          },
          showCustomUi: true,
          strict: false
        }
      }
    },
    {
      setDataValidation: {
        range: {
          sheetId: transactionsSheetId,
          startRowIndex: 1,
          startColumnIndex: 5,
          endColumnIndex: 6
        },
        rule: {
          condition: {
            type: "ONE_OF_RANGE",
            values: [{ userEnteredValue: `=${sheetRef(SHEET_NAMES.categories)}!F2:F20` }]
          },
          showCustomUi: true,
          strict: false
        }
      }
    },
    {
      addChart: {
        chart: {
          spec: {
            title: "Денежный поток по месяцам",
            basicChart: {
              chartType: "COLUMN",
              legendPosition: "BOTTOM_LEGEND",
              axis: [
                { position: "BOTTOM_AXIS", title: "Месяц" },
                { position: "LEFT_AXIS", title: "₽" }
              ],
              domains: [
                {
                  domain: {
                    sourceRange: {
                      sources: [
                        {
                          sheetId: ddsSheetId,
                          startRowIndex: 1,
                          startColumnIndex: 0,
                          endColumnIndex: 1
                        }
                      ]
                    }
                  }
                }
              ],
              series: [
                {
                  series: {
                    sourceRange: {
                      sources: [
                        {
                          sheetId: ddsSheetId,
                          startRowIndex: 1,
                          startColumnIndex: 1,
                          endColumnIndex: 2
                        }
                      ]
                    }
                  },
                  targetAxis: "LEFT_AXIS"
                },
                {
                  series: {
                    sourceRange: {
                      sources: [
                        {
                          sheetId: ddsSheetId,
                          startRowIndex: 1,
                          startColumnIndex: 2,
                          endColumnIndex: 3
                        }
                      ]
                    }
                  },
                  targetAxis: "LEFT_AXIS"
                },
                {
                  series: {
                    sourceRange: {
                      sources: [
                        {
                          sheetId: ddsSheetId,
                          startRowIndex: 1,
                          startColumnIndex: 3,
                          endColumnIndex: 4
                        }
                      ]
                    }
                  },
                  type: "LINE",
                  targetAxis: "LEFT_AXIS"
                }
              ],
              headerCount: 0
            }
          },
          position: {
            overlayPosition: {
              anchorCell: {
                sheetId: dashboardSheetId,
                rowIndex: 8,
                columnIndex: 0
              },
              offsetXPixels: 0,
              offsetYPixels: 0,
              widthPixels: 760,
              heightPixels: 320
            }
          }
        }
      }
    },
    {
      addChart: {
        chart: {
          spec: {
            title: "Прибыль по месяцам",
            basicChart: {
              chartType: "LINE",
              legendPosition: "BOTTOM_LEGEND",
              axis: [
                { position: "BOTTOM_AXIS", title: "Месяц" },
                { position: "LEFT_AXIS", title: "₽" }
              ],
              domains: [
                {
                  domain: {
                    sourceRange: {
                      sources: [
                        {
                          sheetId: pnlSheetId,
                          startRowIndex: 1,
                          startColumnIndex: 0,
                          endColumnIndex: 1
                        }
                      ]
                    }
                  }
                }
              ],
              series: [
                {
                  series: {
                    sourceRange: {
                      sources: [
                        {
                          sheetId: pnlSheetId,
                          startRowIndex: 1,
                          startColumnIndex: 1,
                          endColumnIndex: 2
                        }
                      ]
                    }
                  },
                  targetAxis: "LEFT_AXIS"
                },
                {
                  series: {
                    sourceRange: {
                      sources: [
                        {
                          sheetId: pnlSheetId,
                          startRowIndex: 1,
                          startColumnIndex: 5,
                          endColumnIndex: 6
                        }
                      ]
                    }
                  },
                  targetAxis: "LEFT_AXIS"
                }
              ],
              headerCount: 0
            }
          },
          position: {
            overlayPosition: {
              anchorCell: {
                sheetId: dashboardSheetId,
                rowIndex: 8,
                columnIndex: 8
              },
              offsetXPixels: 0,
              offsetYPixels: 0,
              widthPixels: 760,
              heightPixels: 320
            }
          }
        }
      }
    },
    {
      addChart: {
        chart: {
          spec: {
            title: "Структура расходов по категориям",
            pieChart: {
              legendPosition: "RIGHT_LEGEND",
              domain: {
                sourceRange: {
                  sources: [
                    {
                      sheetId: dashboardSheetId,
                      startRowIndex: 2,
                      startColumnIndex: 6,
                      endColumnIndex: 7
                    }
                  ]
                }
              },
              series: {
                sourceRange: {
                  sources: [
                    {
                      sheetId: dashboardSheetId,
                      startRowIndex: 2,
                      startColumnIndex: 7,
                      endColumnIndex: 8
                    }
                  ]
                }
              },
              pieHole: 0.45
            }
          },
          position: {
            overlayPosition: {
              anchorCell: {
                sheetId: dashboardSheetId,
                rowIndex: 26,
                columnIndex: 0
              },
              offsetXPixels: 0,
              offsetYPixels: 0,
              widthPixels: 600,
              heightPixels: 340
            }
          }
        }
      }
    }
  ];

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: config.spreadsheetId,
    requestBody: { requests }
  });
}

async function main() {
  const sheets = await getSheetsClient();
  const spreadsheet = await getSpreadsheet(sheets);

  await ensureSheets(sheets, spreadsheet);
  const refreshedSpreadsheet = await getSpreadsheet(sheets);
  await writeBaseTables(sheets, refreshedSpreadsheet);
  await migrateExistingTransactions(sheets);
  await applyFormattingAndCharts(sheets);

  console.log("Spreadsheet template is ready");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
