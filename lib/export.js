export function csvCell(value) {
  const raw = String(value ?? "");
  const formulaLike = /^[\u0000-\u0020]*[=+\-@]/.test(raw);
  const safe = formulaLike ? `'${raw}` : raw;
  return /[",\r\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

export const SCHEDULE_FA_A3_HEADERS = Object.freeze([
  "Country/Region name",
  "Country Name and Code",
  "Name of entity",
  "Address of entity",
  "ZIP Code",
  "Nature of entity",
  "Date of acquiring the interest",
  "Initial value of the investment",
  "Peak value of investment during the Period",
  "Closing balance",
  "Total gross amount paid/credited with respect to the holding during the period",
  "Total gross proceeds from sale or redemption of investment during the period",
]);

export const SCHEDULE_FA_A3_ROW_KEYS = Object.freeze([
  "countryRegionName",
  "countryNameAndCode",
  "entityName",
  "entityAddress",
  "zipCode",
  "natureOfEntity",
  "acquisitionDate",
  "initialValueOfInvestment",
  "peakValueOfInvestmentDuringPeriod",
  "closingBalance",
  "totalGrossAmountPaidCreditedWithRespectToHoldingDuringPeriod",
  "totalGrossProceedsFromSaleOrRedemptionOfInvestmentDuringPeriod",
]);

const REQUIRED_TEXT_FIELDS = Object.freeze([
  "countryRegionName",
  "countryNameAndCode",
  "entityName",
  "entityAddress",
  "zipCode",
  "natureOfEntity",
]);

const TEXT_MAX_LENGTHS = Object.freeze({
  entityAddress: 35,
  zipCode: 8,
});

const REQUIRED_NUMERIC_FIELDS = Object.freeze([
  "initialValueOfInvestment",
  "peakValueOfInvestmentDuringPeriod",
  "closingBalance",
  "totalGrossAmountPaidCreditedWithRespectToHoldingDuringPeriod",
  "totalGrossProceedsFromSaleOrRedemptionOfInvestmentDuringPeriod",
]);

const MONTHS = Object.freeze([
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
]);

export class ScheduleFaA3CsvValidationError extends Error {
  constructor(errors) {
    super("Schedule FA A3 CSV rows failed validation");
    this.name = "ScheduleFaA3CsvValidationError";
    this.code = "SCHEDULE_FA_A3_VALIDATION_FAILED";
    this.errors = errors;
  }
}

export function buildScheduleFaA3Csv(rows) {
  if (!Array.isArray(rows)) {
    throw new ScheduleFaA3CsvValidationError([
      {
        row: null,
        field: "rows",
        code: "required_array",
        message: "Schedule FA A3 rows must be an array.",
      },
    ]);
  }

  const validationErrors = validateScheduleFaA3Rows(rows);
  if (validationErrors.length > 0) {
    throw new ScheduleFaA3CsvValidationError(validationErrors);
  }

  return [
    SCHEDULE_FA_A3_HEADERS.map(csvCell).join(","),
    ...rows.map((row) =>
      SCHEDULE_FA_A3_ROW_KEYS.map((key) =>
        csvCell(formatScheduleFaA3Value(key, row[key])),
      ).join(","),
    ),
  ].join("\r\n");
}

function validateScheduleFaA3Rows(rows) {
  return rows.flatMap((row, index) => {
    const rowNumber = index + 1;
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      return [
        {
          row: rowNumber,
          field: "row",
          code: "required_object",
          message: "Schedule FA A3 row must be an object.",
        },
      ];
    }

    return [
      ...REQUIRED_TEXT_FIELDS.flatMap((field) =>
        !hasTextValue(row[field])
          ? [
              {
                row: rowNumber,
                field,
                code: "required",
                message: `${field} is required.`,
              },
            ]
          : TEXT_MAX_LENGTHS[field] &&
              String(row[field]).trim().length > TEXT_MAX_LENGTHS[field]
            ? [
                {
                  row: rowNumber,
                  field,
                  code: "max_length",
                  message: `${field} must be ${TEXT_MAX_LENGTHS[field]} characters or fewer.`,
                },
              ]
            : [],
      ),
      ...validateAcquisitionDate(row, rowNumber),
      ...REQUIRED_NUMERIC_FIELDS.flatMap((field) =>
        hasNumericValue(row[field])
          ? []
          : [
              {
                row: rowNumber,
                field,
                code: "required_number",
                message: `${field} must be a finite number.`,
              },
            ],
      ),
    ];
  });
}

function validateAcquisitionDate(row, rowNumber) {
  return formatAcquisitionDate(row.acquisitionDate)
    ? []
    : [
        {
          row: rowNumber,
          field: "acquisitionDate",
          code: "required_date",
          message: "acquisitionDate must be a valid date.",
        },
      ];
}

function formatScheduleFaA3Value(key, value) {
  if (key === "acquisitionDate") return formatAcquisitionDate(value);
  if (REQUIRED_NUMERIC_FIELDS.includes(key)) return String(Number(value));
  return value;
}

function formatAcquisitionDate(value) {
  const date = parseDateOnly(value);
  if (!date) return "";
  const day = String(date.day).padStart(2, "0");
  return `${day}-${MONTHS[date.month - 1]}-${date.year}`;
}

function parseDateOnly(value) {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return {
      year: value.getUTCFullYear(),
      month: value.getUTCMonth() + 1,
      day: value.getUTCDate(),
    };
  }

  const text = String(value ?? "").trim();
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() + 1 !== month ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return { year, month, day };
}

function hasTextValue(value) {
  return String(value ?? "").trim() !== "";
}

function hasNumericValue(value) {
  if (value === "" || value === null || value === undefined) return false;
  return Number.isFinite(Number(value));
}
