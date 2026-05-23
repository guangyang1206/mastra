import type { FieldConfig } from '@autoform/core';
import { buildZodFieldConfig } from '@autoform/react';
import { z } from 'zod';
import type { FieldTypes } from './auto-form';
import { convertSchemaToZod } from '@mastra/schema-compat/utils';

// @ts-expect-error - TODO
export const fieldConfig: FieldConfig = buildZodFieldConfig<
  FieldTypes,
  {
    // Add types for `customData` here.
  }
>();

export function removeEmptyValues<T extends Record<string, any>>(values: T): Partial<T> {
  const result: Partial<T> = {};
  for (const key in values) {
    const value = values[key];
    if ([null, undefined, '', [], {}].includes(value)) {
      continue;
    }

    if (Array.isArray(value)) {
      const newArray = value.map((item: any) => {
        if (typeof item === 'object') {
          const cleanedItem = removeEmptyValues(item);
          if (Object.keys(cleanedItem).length > 0) {
            return cleanedItem;
          }
          return null;
        }
        return item;
      });
      const filteredArray = newArray.filter((item: any) => item !== null);
      if (filteredArray.length > 0) {
        result[key] = filteredArray;
      }
    } else if (typeof value === 'object') {
      const cleanedValue = removeEmptyValues(value);
      if (Object.keys(cleanedValue).length > 0) {
        result[key] = cleanedValue as any;
      }
    } else {
      result[key] = value;
    }
  }

  return result;
}

/**
 * Convert a JSON Schema or serialized Zod schema to a ZodType object.
 * 
 * This function safely converts schemas without using `Function()` (which violates CSP).
 * 
 * @param obj - JSON Schema object or serialized Zod schema string
 * @returns resolved zod object
 * @see https://github.com/mastra-ai/mastra/issues/16992
 */
export function resolveSerializedZodOutput(obj: any): z.ZodType {
  return convertSchemaToZod(obj);
}
