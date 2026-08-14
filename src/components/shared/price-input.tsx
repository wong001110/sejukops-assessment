"use client";

import { InputNumber, type InputNumberProps } from "antd";
import type { ComponentPropsWithoutRef } from "react";

type SharedPriceInputProps = Readonly<{
  fluid?: boolean;
  className?: string;
}>;

type AntPriceInputProps = SharedPriceInputProps &
  Omit<InputNumberProps<number>, "min" | "precision" | "prefix" | "className"> &
  Readonly<{ mode?: "antd" }>;

type NativePriceInputProps = SharedPriceInputProps &
  Omit<ComponentPropsWithoutRef<"input">, "type" | "min" | "step" | "className"> &
  Readonly<{ mode: "native" }>;

export type PriceInputProps = AntPriceInputProps | NativePriceInputProps;

function classes(className: string | undefined, fluid: boolean | undefined, native = false) {
  return [
    "price-input",
    fluid ? "price-input-fluid" : "",
    native ? "price-input-native" : "",
    className ?? "",
  ].filter(Boolean).join(" ");
}

/**
 * Shared operational money input.
 *
 * Desktop Ant Design forms use the 1.3x default width. Mobile field forms can
 * opt into `fluid` while keeping the same money semantics and sizing token.
 */
export function PriceInput(props: PriceInputProps) {
  if (props.mode === "native") {
    const { mode, fluid, className, ...inputProps } = props;
    void mode;
    return (
      <input
        {...inputProps}
        type="number"
        min="0"
        step="0.01"
        inputMode="decimal"
        className={classes(className, fluid, true)}
      />
    );
  }

  const { mode, fluid, className, ...inputNumberProps } = props;
  void mode;
  return (
    <InputNumber<number>
      {...inputNumberProps}
      min={0}
      precision={2}
      prefix="RM"
      className={classes(className, fluid)}
    />
  );
}
