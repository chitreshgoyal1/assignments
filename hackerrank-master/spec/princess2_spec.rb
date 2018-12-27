# frozen_string_literal: true

require 'spec_helper'

describe 'nextMove' do
  before :each do
    @grid_size = 5
    @matrix = [['-', 'p', '-', '', '-'],
               ['-', '-', '-', '-', '-'],
               ['-', '-', '-', '-', 'm'],
               ['', '-', '-', '-', '-'],
               ['-', '-', '-', '-', '-']]
  end

  it 'takes only odd number for size of grid' do
    is_even_number = @grid_size.odd?
    expect(is_even_number).to eql true
  end

  it 'takes only number greater and equal to 3 and less than 100' do
    number = true if @grid_size >= 3 || @grid_size < 100
    expect(number).to eql true
  end

  it 'check the next move of bot, it should be inside grid' do
    @matrix.each_index do |row| col = @matrix[row].index 'm'; @rc = [row, col] if col end
    bot_x = @rc[0]
    bot_y = @rc[1]
    @matrix.each_index do |row| col = @matrix[row].index 'p'; @princess = [row, col] if col end
    princess_x = @princess[0]
    princess_y = @princess[1]
    move = checkMove(bot_x, bot_y, princess_x, princess_y)

    expect(move).not_to be_empty
  end
end
