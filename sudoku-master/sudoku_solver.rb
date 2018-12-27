class Array
  def valid?
    /\A[1-9]{9}\z/ === uniq.join
  end
end


def sudoku_validator(sudoku)
  sudoku.each_with_index do |line, x|
    return 'Invalid!' unless line.valid?

    if [0,3,6].include?(x)
      [0,3,6].each do |y|
      	# "sudoku[#{x}][#{y},3] + sudoku[#{x+1}][#{y},3] + sudoku[#{x+2}][#{y},3]"
      	line = sudoku[x][y, 3] + sudoku[x + 1][y, 3] + sudoku[x + 2][y, 3]
        return 'Invalid!' unless line.valid?
      end
    end
  end
  sudoku.transpose.each do |line|
    return 'Invalid!' unless line.valid?
  end

  'Valid!'
end

sudoku = [
[5, 3, 4, 6, 7, 8, 9, 1, 2],
[6, 7, 2, 1, 9, 5, 3, 4, 8],
[1, 9, 8, 3, 4, 2, 5, 6, 7],
[8, 5, 9, 7, 6, 1, 4, 2, 3],
[4, 2, 6, 8, 5, 3, 7, 9, 1],
[7, 1, 3, 9, 2, 4, 8, 5, 6],
[9, 6, 1, 5, 3, 7, 2, 8, 4],
[2, 8, 7, 4, 1, 9, 6, 3, 5],
[3, 4, 5, 2, 8, 6, 1, 7, 9]
]


p sudoku_validator(sudoku)
